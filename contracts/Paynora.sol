// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Paynora
 * @notice Non-custodial USDC payments and payee-signed payment requests for Arc Mainnet (5042).
 * @dev No owner, admin, fees, pausing, upgrades, or rescue mechanism exists. Payments move
 * directly from the caller to the recipient; this router never takes custody in its flows.
 * Approve only the exact payment amount. USDC uses six ERC-20 decimals and is also Arc's
 * native gas token; these functions use its ERC-20 interface, not native value transfers.
 * Notes are public onchain. Unsolicited tokens or forced native funds cannot be recovered.
 * The inherited eip712Domain() exposes the signing domain, including chain and deployment.
 */
contract Paynora is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Arc's fixed USDC ERC-20 predeploy; all amounts use six-decimal base units.
    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    /// @notice Maximum note length in bytes, not Unicode characters.
    uint256 public constant MAX_NOTE_BYTES = 140;

    /// @notice EIP-712 type hash; the dynamic note is hashed separately when encoding.
    bytes32 public constant PAYMENT_REQUEST_TYPEHASH = keccak256(
        "PaymentRequest(address payee,uint256 amount,bytes32 requestId,string note,uint256 expiry)"
    );

    /**
     * @notice An exact-amount payment request authorised by its payee, payable by anyone.
     * @dev IDs are scoped to each payee. Reusing an ID shares its paid/cancelled state.
     * @param payee Recipient whose EOA or ERC-1271 signature authorises the request.
     * @param amount Exact USDC amount in six-decimal base units.
     * @param requestId Nonzero identifier unique among this payee's intended requests.
     * @param note Public note of at most MAX_NOTE_BYTES bytes.
     * @param expiry Last Unix timestamp at which payment is accepted, inclusive.
     */
    struct PaymentRequest {
        address payee;
        uint256 amount;
        bytes32 requestId;
        string note;
        uint256 expiry;
    }

    /// @notice Whether a payee's request ID has been paid or cancelled permanently.
    mapping(address payee => mapping(bytes32 requestId => bool closed)) public requestClosed;

    /**
     * @notice Emitted after a successful direct transfer from payer to recipient.
     * @param from Payer whose USDC and allowance were used.
     * @param to Recipient of the USDC.
     * @param amount USDC transferred in six-decimal base units.
     * @param requestId Signed request ID, or zero for a direct payment.
     * @param note Public note accompanying the payment.
     */
    event PaymentSent(address indexed from, address indexed to, uint256 amount, bytes32 indexed requestId, string note);

    /**
     * @notice Emitted when a payee permanently cancels their request ID.
     * @param payee Caller who owns the request ID namespace.
     * @param requestId Identifier that can no longer be paid.
     */
    event RequestCancelled(address indexed payee, bytes32 indexed requestId);

    /**
     * @notice The recipient is zero or this router.
     * @param recipient Rejected recipient address.
     */
    error InvalidRecipient(address recipient);

    /**
     * @notice A payment amount must be positive.
     * @param amount Rejected amount in USDC base units.
     */
    error InvalidAmount(uint256 amount);

    /**
     * @notice The public note exceeds the byte limit.
     * @param length Supplied note length in bytes.
     * @param maximum Maximum permitted length in bytes.
     */
    error NoteTooLong(uint256 length, uint256 maximum);

    /// @notice Zero is reserved for direct payments and cannot identify a request.
    error InvalidRequestId();

    /**
     * @notice The request's inclusive payment deadline has passed.
     * @param expiry Signed deadline as a Unix timestamp.
     * @param currentTimestamp Current block timestamp.
     */
    error RequestExpired(uint256 expiry, uint256 currentTimestamp);

    /**
     * @notice The payee's request ID has already been paid or cancelled.
     * @param payee Owner of the request ID namespace.
     * @param requestId Closed identifier.
     */
    error RequestClosed(address payee, bytes32 requestId);

    /**
     * @notice The payee did not provide a currently valid signature over the request.
     * @param payee Expected EOA or ERC-1271 signer.
     */
    error InvalidSignature(address payee);

    /// @notice A caller cannot pay themselves through this router.
    error SelfPayment();

    /**
     * @notice Initialises the immutable Paynora version 1 signing domain.
     * @dev EIP712 binds signatures to the current chain ID and this deployment address.
     */
    constructor() EIP712("Paynora", "1") {}

    /**
     * @notice Send USDC directly to another address with a public onchain note.
     * @dev Only msg.sender funds the transfer. Exact-amount approvals are recommended.
     * @param to Recipient, excluding zero, this router, and the caller.
     * @param amount Positive USDC amount in six-decimal base units.
     * @param note Public note of at most MAX_NOTE_BYTES bytes.
     */
    function pay(address to, uint256 amount, string calldata note) external nonReentrant {
        _validatePayment(to, amount, note);
        USDC.safeTransferFrom(msg.sender, to, amount);
        emit PaymentSent(msg.sender, to, amount, bytes32(0), note);
    }

    /**
     * @notice Pay an exact-amount, payee-authorised request once from your own wallet.
     * @dev Any payer other than the payee may pay. Supports EOAs and ERC-1271 wallets;
     * contract-wallet signature validity is evaluated at execution time. The request is
     * closed before transferring; a failed transfer rolls back closure. Signing is gasless
     * for the payee. Approve only the exact amount; cancellation is a separate transaction.
     * @param request Signed recipient, amount, identifier, note, and inclusive deadline.
     * @param signature Payee's EIP-712 signature over requestDigest(request).
     */
    function payRequest(PaymentRequest calldata request, bytes calldata signature) external nonReentrant {
        _validatePayment(request.payee, request.amount, request.note);
        if (request.requestId == bytes32(0)) revert InvalidRequestId();
        if (block.timestamp > request.expiry) revert RequestExpired(request.expiry, block.timestamp);
        if (requestClosed[request.payee][request.requestId]) {
            revert RequestClosed(request.payee, request.requestId);
        }
        if (!SignatureChecker.isValidSignatureNow(request.payee, requestDigest(request), signature)) {
            revert InvalidSignature(request.payee);
        }

        requestClosed[request.payee][request.requestId] = true;
        USDC.safeTransferFrom(msg.sender, request.payee, request.amount);
        emit PaymentSent(msg.sender, request.payee, request.amount, request.requestId, request.note);
    }

    /**
     * @notice Permanently invalidate a request ID in your own payee namespace.
     * @dev No signature or prior publication is needed. A paid ID cannot be cancelled again.
     * @param requestId Nonzero identifier to close.
     */
    function cancelRequest(bytes32 requestId) external {
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (requestClosed[msg.sender][requestId]) revert RequestClosed(msg.sender, requestId);
        requestClosed[msg.sender][requestId] = true;
        emit RequestCancelled(msg.sender, requestId);
    }

    /**
     * @notice Return the full EIP-712 digest that the request's payee must sign.
     * @dev Hashes the note per EIP-712. Does not validate fields, expiry, or closure.
     * The domain binds the digest to this chain and deployment, preventing cross-domain replay.
     * @param request Request data to hash exactly as supplied.
     * @return digest Domain-separated EIP-712 signing digest.
     */
    function requestDigest(PaymentRequest calldata request) public view returns (bytes32 digest) {
        return _hashTypedDataV4(keccak256(abi.encode(
            PAYMENT_REQUEST_TYPEHASH,
            request.payee,
            request.amount,
            request.requestId,
            keccak256(bytes(request.note)),
            request.expiry
        )));
    }

    /**
     * @notice Return whether a request ID has not been paid or cancelled.
     * @dev This checks closure only, not validity, expiry, signature, or ID nonzeroness.
     * @param payee Owner of the request ID namespace.
     * @param requestId Identifier whose closure state is queried.
     * @return open True exactly when requestClosed[payee][requestId] is false.
     */
    function isRequestOpen(address payee, bytes32 requestId) external view returns (bool open) {
        return !requestClosed[payee][requestId];
    }

    /**
     * @notice Validate shared direct-payment and request-payment fields.
     * @dev Uses msg.sender as payer; notes are limited by UTF-8 byte length.
     * @param to Intended recipient.
     * @param amount Intended positive USDC amount in base units.
     * @param note Public payment note.
     */
    function _validatePayment(address to, uint256 amount, string calldata note) private view {
        if (to == address(0) || to == address(this)) revert InvalidRecipient(to);
        if (to == msg.sender) revert SelfPayment();
        if (amount == 0) revert InvalidAmount(amount);
        uint256 length = bytes(note).length;
        if (length > MAX_NOTE_BYTES) revert NoteTooLong(length, MAX_NOTE_BYTES);
    }
}
