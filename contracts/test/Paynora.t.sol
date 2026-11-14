// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Paynora} from "../Paynora.sol";

/// @dev Simple 6-decimal ERC-20 etched at the canonical USDC address.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev ERC-1271 wallet: valid iff the hash was signed (ECDSA) by `signer`; can be told to revert.
contract MockWallet1271 {
    address public signer;
    bool public shouldRevert;

    constructor(address _signer) {
        signer = _signer;
    }

    function setRevert(bool v) external {
        shouldRevert = v;
    }

    function isValidSignature(bytes32 h, bytes calldata sig) external view returns (bytes4) {
        if (shouldRevert) revert("boom");
        (address r, ECDSA.RecoverError e,) = ECDSA.tryRecover(h, sig);
        if (e == ECDSA.RecoverError.NoError && r == signer) return 0x1626ba7e;
        return 0xffffffff;
    }
}

abstract contract PaynoraTestBase is Test {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant REQUEST_TYPEHASH = keccak256(
        "PaymentRequest(address payee,uint256 amount,bytes32 requestId,string note,uint256 expiry)"
    );

    event PaymentSent(address indexed from, address indexed to, uint256 amount, bytes32 indexed requestId, string note);
    event RequestCancelled(address indexed payee, bytes32 indexed requestId);

    MockUSDC internal usdc;
    Paynora internal p;

    address internal alice;
    uint256 internal alicePk;
    address internal bob;
    uint256 internal bobPk;
    address internal carol;
    uint256 internal carolPk;
    address internal dave = makeAddr("dave");

    uint256 internal constant START = 1_700_000_000;
    uint256 internal constant FUNDS = 1_000_000e6;

    function setUp() public virtual {
        vm.warp(START);
        MockUSDC m = new MockUSDC();
        vm.etch(USDC, address(m).code);
        usdc = MockUSDC(USDC);
        p = new Paynora();

        (alice, alicePk) = makeAddrAndKey("alice");
        (bob, bobPk) = makeAddrAndKey("bob");
        (carol, carolPk) = makeAddrAndKey("carol");

        usdc.mint(alice, FUNDS);
        usdc.mint(carol, FUNDS);
        usdc.mint(dave, FUNDS); // dave never approves
        vm.prank(alice);
        usdc.approve(address(p), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(p), type(uint256).max);
    }

    // ---------- helpers ----------

    function _note(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; ++i) {
            b[i] = "a";
        }
        return string(b);
    }

    function _req(address payee, uint256 amount, bytes32 id, string memory note, uint256 expiry)
        internal
        pure
        returns (Paynora.PaymentRequest memory)
    {
        return Paynora.PaymentRequest(payee, amount, id, note, expiry);
    }

    /// @dev Independent EIP-712 digest (does not call Paynora.requestDigest).
    function _digestFor(address verifying, Paynora.PaymentRequest memory r) internal view returns (bytes32) {
        bytes32 domainSep = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("Paynora"), keccak256("1"), block.chainid, verifying)
        );
        bytes32 structHash = keccak256(
            abi.encode(REQUEST_TYPEHASH, r.payee, r.amount, r.requestId, keccak256(bytes(r.note)), r.expiry)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    function _digest(Paynora.PaymentRequest memory r) internal view returns (bytes32) {
        return _digestFor(address(p), r);
    }

    function _sign(uint256 pk, Paynora.PaymentRequest memory r) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, _digest(r));
        return abi.encodePacked(rr, s, v);
    }
}

contract PaynoraTest is PaynoraTestBase {
    bytes32 internal constant ID1 = bytes32(uint256(1));
    bytes32 internal constant ID2 = bytes32(uint256(2));

    // =====================================================================
    // Deployment / constants
    // =====================================================================

    function test_Constants() public view {
        assertEq(address(p.USDC()), USDC);
        assertEq(p.MAX_NOTE_BYTES(), 140);
        assertEq(p.PAYMENT_REQUEST_TYPEHASH(), REQUEST_TYPEHASH);
        assertEq(usdc.decimals(), 6);
    }

    function test_Eip712Domain() public view {
        (, string memory name, string memory version, uint256 chainId, address vc,,) = p.eip712Domain();
        assertEq(name, "Paynora");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(vc, address(p));
    }

    function test_RequestDigestMatchesIndependentComputation() public view {
        Paynora.PaymentRequest memory r = _req(bob, 5e6, ID1, "hello", START + 1 days);
        assertEq(p.requestDigest(r), _digest(r));
    }

    function test_IsRequestOpenDefaultsTrue() public view {
        assertTrue(p.isRequestOpen(bob, ID1));
        assertFalse(p.requestClosed(bob, ID1));
    }

    // =====================================================================
    // pay — happy path / events / no custody
    // =====================================================================

    function test_Pay_MovesFundsDirectly() public {
        vm.prank(alice);
        p.pay(bob, 10e6, "lunch");
        assertEq(usdc.balanceOf(bob), 10e6);
        assertEq(usdc.balanceOf(alice), FUNDS - 10e6);
        assertEq(usdc.balanceOf(address(p)), 0);
    }

    function test_Pay_EmitsPaymentSentWithZeroRequestId() public {
        vm.expectEmit(true, true, true, true, address(p));
        emit PaymentSent(alice, bob, 7e6, bytes32(0), "thanks");
        vm.prank(alice);
        p.pay(bob, 7e6, "thanks");
    }

    function test_Pay_EmitsUsdcTransferFromPayerToRecipient() public {
        vm.expectEmit(true, true, false, true, USDC);
        emit IERC20.Transfer(alice, bob, 3e6);
        vm.prank(alice);
        p.pay(bob, 3e6, "");
    }

    function test_Pay_ConsumesAllowance() public {
        vm.prank(dave);
        usdc.approve(address(p), 5e6);
        vm.prank(dave);
        p.pay(bob, 5e6, "x");
        assertEq(usdc.allowance(dave, address(p)), 0);
    }

    function test_Pay_DoesNotCloseAnyRequest() public {
        vm.prank(alice);
        p.pay(bob, 1e6, "x");
        assertTrue(p.isRequestOpen(bob, bytes32(0)));
    }

    // =====================================================================
    // pay — revert paths
    // =====================================================================

    function test_RevertPay_ZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidRecipient.selector, address(0)));
        p.pay(address(0), 1e6, "x");
    }

    function test_RevertPay_RecipientIsPaynora() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidRecipient.selector, address(p)));
        p.pay(address(p), 1e6, "x");
    }

    function test_RevertPay_SelfPayment() public {
        vm.prank(alice);
        vm.expectRevert(Paynora.SelfPayment.selector);
        p.pay(alice, 1e6, "x");
    }

    function test_RevertPay_ZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidAmount.selector, 0));
        p.pay(bob, 0, "x");
    }

    function test_Pay_Note140BytesOk() public {
        vm.prank(alice);
        p.pay(bob, 1e6, _note(140));
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_RevertPay_Note141Bytes() public {
        string memory n = _note(141);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.NoteTooLong.selector, 141, 140));
        p.pay(bob, 1e6, n);
    }

    function test_Pay_NoteLimitIsBytesNotCharacters() public {
        // "é" is 2 bytes in UTF-8: 70 chars = 140 bytes (ok); 71 chars = 142 bytes (revert).
        bytes memory ok;
        for (uint256 i; i < 70; ++i) {
            ok = abi.encodePacked(ok, unicode"é");
        }
        assertEq(ok.length, 140);
        vm.prank(alice);
        p.pay(bob, 1e6, string(ok));

        bytes memory bad = abi.encodePacked(ok, unicode"é");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.NoteTooLong.selector, 142, 140));
        p.pay(bob, 1e6, string(bad));
    }

    function test_RevertPay_MissingAllowance() public {
        vm.prank(dave);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(p), 0, 1e6)
        );
        p.pay(bob, 1e6, "x");
    }

    function test_RevertPay_InsufficientAllowance() public {
        vm.startPrank(dave);
        usdc.approve(address(p), 1e6 - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(p), 1e6 - 1, 1e6)
        );
        p.pay(bob, 1e6, "x");
        vm.stopPrank();
    }

    function test_RevertPay_InsufficientBalance() public {
        address poor = makeAddr("poor");
        vm.startPrank(poor);
        usdc.approve(address(p), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 0, 1e6));
        p.pay(bob, 1e6, "x");
        vm.stopPrank();
    }

    // =====================================================================
    // cancelRequest
    // =====================================================================

    function test_Cancel_ClosesAndEmits() public {
        vm.expectEmit(true, true, false, true, address(p));
        emit RequestCancelled(bob, ID1);
        vm.prank(bob);
        p.cancelRequest(ID1);
        assertFalse(p.isRequestOpen(bob, ID1));
        assertTrue(p.requestClosed(bob, ID1));
    }

    function test_RevertCancel_ZeroId() public {
        vm.prank(bob);
        vm.expectRevert(Paynora.InvalidRequestId.selector);
        p.cancelRequest(bytes32(0));
    }

    function test_RevertCancel_Twice() public {
        vm.startPrank(bob);
        p.cancelRequest(ID1);
        vm.expectRevert(abi.encodeWithSelector(Paynora.RequestClosed.selector, bob, ID1));
        p.cancelRequest(ID1);
        vm.stopPrank();
    }

    function test_CancelDoesNotAffectOtherPayeesNamespace() public {
        vm.prank(carol);
        p.cancelRequest(ID1);
        assertTrue(p.isRequestOpen(bob, ID1));
        assertFalse(p.isRequestOpen(carol, ID1));
    }

    // =====================================================================
    // payRequest — happy paths
    // =====================================================================

    function test_PayRequest_EoaSignature() public {
        Paynora.PaymentRequest memory r = _req(bob, 25e6, ID1, "invoice 1", START + 1 days);
        bytes memory sig = _sign(bobPk, r);

        vm.expectEmit(true, true, true, true, address(p));
        emit PaymentSent(alice, bob, 25e6, ID1, "invoice 1");
        vm.prank(alice);
        p.payRequest(r, sig);

        assertEq(usdc.balanceOf(bob), 25e6);
        assertEq(usdc.balanceOf(alice), FUNDS - 25e6);
        assertEq(usdc.balanceOf(address(p)), 0);
        assertFalse(p.isRequestOpen(bob, ID1));
    }

    function test_PayRequest_SignedViaContractDigestToo() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "n", START + 1 hours);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(bobPk, p.requestDigest(r));
        vm.prank(alice);
        p.payRequest(r, abi.encodePacked(rr, s, v));
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_PayRequest_Erc1271Wallet() public {
        MockWallet1271 w = new MockWallet1271(bob);
        Paynora.PaymentRequest memory r = _req(address(w), 9e6, ID1, "wallet", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(address(w)), 9e6);
        assertEq(usdc.balanceOf(address(p)), 0);
        assertFalse(p.isRequestOpen(address(w), ID1));
    }

    function test_PayRequest_AnyThirdPartyCanPay() public {
        Paynora.PaymentRequest memory r = _req(bob, 4e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(carol);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 4e6);
        assertEq(usdc.balanceOf(carol), FUNDS - 4e6);
    }

    function test_PayRequest_NoteBoundary() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, _note(140), START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    // =====================================================================
    // payRequest — expiry
    // =====================================================================

    function test_PayRequest_ExpiryEqualsTimestampOk() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 100);
        bytes memory sig = _sign(bobPk, r);
        vm.warp(START + 100);
        vm.prank(alice);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_RevertPayRequest_ExpiredByOneSecond() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 100);
        bytes memory sig = _sign(bobPk, r);
        vm.warp(START + 101);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.RequestExpired.selector, START + 100, START + 101));
        p.payRequest(r, sig);
        assertTrue(p.isRequestOpen(bob, ID1));
    }

    // =====================================================================
    // payRequest — field validation reverts
    // =====================================================================

    function test_RevertPayRequest_ZeroRequestId() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, bytes32(0), "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        vm.expectRevert(Paynora.InvalidRequestId.selector);
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_PayeePaysOwnRequest() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(bob);
        vm.expectRevert(Paynora.SelfPayment.selector);
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_ZeroPayee() public {
        Paynora.PaymentRequest memory r = _req(address(0), 1e6, ID1, "x", START + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidRecipient.selector, address(0)));
        p.payRequest(r, hex"");
    }

    function test_RevertPayRequest_PayeeIsPaynora() public {
        Paynora.PaymentRequest memory r = _req(address(p), 1e6, ID1, "x", START + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidRecipient.selector, address(p)));
        p.payRequest(r, hex"");
    }

    function test_RevertPayRequest_ZeroAmount() public {
        Paynora.PaymentRequest memory r = _req(bob, 0, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidAmount.selector, 0));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_Note141() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, _note(141), START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.NoteTooLong.selector, 141, 140));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_MissingAllowanceKeepsRequestOpen() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(dave);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(p), 0, 1e6)
        );
        p.payRequest(r, sig);
        assertTrue(p.isRequestOpen(bob, ID1));
        assertEq(usdc.balanceOf(bob), 0);
    }

    // =====================================================================
    // payRequest — signature failures
    // =====================================================================

    function test_RevertPayRequest_WrongSigner() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(carolPk, r);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_EmptyAndMalformedSignature() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, hex"");
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, hex"deadbeef");
        vm.stopPrank();
    }

    function test_RevertPayRequest_TamperedAmount() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        r.amount = 2e6;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_TamperedNote() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        r.note = "y";
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_TamperedExpiry() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        r.expiry = START + 2 days;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_TamperedRequestId() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        r.requestId = ID2;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_TamperedPayee() public {
        // bob's signature cannot redirect funds to carol.
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        r.payee = carol;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, carol));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_HighSMalleatedSignatureRejected() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(bobPk, _digest(r));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleated = abi.encodePacked(rr, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, malleated);
    }

    function test_RevertPayRequest_SignatureForOtherDeployment() public {
        Paynora other = new Paynora();
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(bobPk, _digestFor(address(other), r));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, abi.encodePacked(rr, s, v));
    }

    function test_RevertPayRequest_CrossChainReplay() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.chainId(block.chainid + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
        // sanity: back on the original chain the same signature is valid
        vm.chainId(block.chainid - 1);
        vm.prank(alice);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_PayRequest_SignedForNewChainIdWorksAfterChainChange() public {
        vm.chainId(5042);
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r); // digest computed with chainid 5042
        assertEq(p.requestDigest(r), _digest(r));
        vm.prank(alice);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    // =====================================================================
    // payRequest — ERC-1271 edge cases
    // =====================================================================

    function test_RevertPayRequest_Erc1271WrongSigner() public {
        MockWallet1271 w = new MockWallet1271(bob);
        Paynora.PaymentRequest memory r = _req(address(w), 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(carolPk, r);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, address(w)));
        p.payRequest(r, sig);
    }

    function test_RevertPayRequest_Erc1271RevertingSigner() public {
        MockWallet1271 w = new MockWallet1271(bob);
        Paynora.PaymentRequest memory r = _req(address(w), 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        w.setRevert(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, address(w)));
        p.payRequest(r, sig);
        assertTrue(p.isRequestOpen(address(w), ID1));
    }

    function test_PayRequest_Erc1271ValidityEvaluatedAtExecution() public {
        MockWallet1271 w = new MockWallet1271(bob);
        Paynora.PaymentRequest memory r = _req(address(w), 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        w.setRevert(true);
        w.setRevert(false);
        vm.prank(alice);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(address(w)), 1e6);
    }

    // =====================================================================
    // payRequest — closure / replay / namespaces
    // =====================================================================

    function test_RevertPayRequest_DoublePay() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        p.payRequest(r, sig);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Paynora.RequestClosed.selector, bob, ID1));
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_RevertPayRequest_CancelThenPay() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(bob);
        p.cancelRequest(ID1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.RequestClosed.selector, bob, ID1));
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_RevertCancel_AfterPaid() public {
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        p.payRequest(r, sig);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Paynora.RequestClosed.selector, bob, ID1));
        p.cancelRequest(ID1);
    }

    function test_RequestIdNamespaceIsolationPerPayee() public {
        // Same id used by two payees: paying bob's does not close carol's.
        Paynora.PaymentRequest memory rb = _req(bob, 1e6, ID1, "b", START + 1 days);
        Paynora.PaymentRequest memory rc = _req(carol, 2e6, ID1, "c", START + 1 days);
        bytes memory sb = _sign(bobPk, rb);
        bytes memory sc = _sign(carolPk, rc);

        vm.prank(alice);
        p.payRequest(rb, sb);
        assertFalse(p.isRequestOpen(bob, ID1));
        assertTrue(p.isRequestOpen(carol, ID1));

        vm.prank(alice);
        p.payRequest(rc, sc);
        assertFalse(p.isRequestOpen(carol, ID1));
    }

    function test_CancellingForeignNamespaceDoesNotBlockPayee() public {
        // An attacker cancelling id 1 in their own namespace cannot grief bob's id 1.
        vm.prank(dave);
        p.cancelRequest(ID1);
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.prank(alice);
        p.payRequest(r, sig);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_DifferentIdsSamePayeeIndependent() public {
        Paynora.PaymentRequest memory r1 = _req(bob, 1e6, ID1, "x", START + 1 days);
        Paynora.PaymentRequest memory r2 = _req(bob, 1e6, ID2, "x", START + 1 days);
        bytes memory s1 = _sign(bobPk, r1);
        bytes memory s2 = _sign(bobPk, r2);
        vm.prank(alice);
        p.payRequest(r1, s1);
        assertTrue(p.isRequestOpen(bob, ID2));
        vm.prank(alice);
        p.payRequest(r2, s2);
        assertEq(usdc.balanceOf(bob), 2e6);
    }

    // =====================================================================
    // Fuzz
    // =====================================================================

    function testFuzz_Pay_ConservesBalancesAndNeverCustodies(address to, uint256 amount, uint256 noteLen) public {
        vm.assume(to != address(0) && to != address(p) && to != alice && to != USDC);
        amount = bound(amount, 1, FUNDS);
        noteLen = bound(noteLen, 0, 140);

        uint256 toBefore = usdc.balanceOf(to);
        uint256 supply = usdc.totalSupply();

        vm.expectEmit(true, true, true, true, address(p));
        emit PaymentSent(alice, to, amount, bytes32(0), _note(noteLen));
        vm.prank(alice);
        p.pay(to, amount, _note(noteLen));

        assertEq(usdc.balanceOf(to), toBefore + amount);
        assertEq(usdc.balanceOf(alice), FUNDS - amount);
        assertEq(usdc.balanceOf(address(p)), 0);
        assertEq(usdc.totalSupply(), supply);
    }

    function testFuzz_Pay_NoteLengthBoundary(uint256 len) public {
        len = bound(len, 0, 400);
        string memory n = _note(len);
        vm.prank(alice);
        if (len > 140) {
            vm.expectRevert(abi.encodeWithSelector(Paynora.NoteTooLong.selector, len, 140));
            p.pay(bob, 1e6, n);
        } else {
            p.pay(bob, 1e6, n);
            assertEq(usdc.balanceOf(bob), 1e6);
        }
    }

    function testFuzz_Pay_AmountAboveBalanceReverts(uint256 amount) public {
        amount = bound(amount, FUNDS + 1, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, FUNDS, amount)
        );
        p.pay(bob, amount, "x");
    }

    function testFuzz_PayRequest_Roundtrip(uint256 amount, bytes32 id, uint256 expiry, uint256 nowTs, uint8 noteLen)
        public
    {
        amount = bound(amount, 1, FUNDS);
        vm.assume(id != bytes32(0));
        expiry = bound(expiry, 0, type(uint128).max);
        nowTs = bound(nowTs, 0, type(uint128).max);
        string memory note = _note(bound(noteLen, 0, 140));

        Paynora.PaymentRequest memory r = _req(bob, amount, id, note, expiry);
        bytes memory sig = _sign(bobPk, r);
        vm.warp(nowTs);

        vm.prank(alice);
        if (nowTs > expiry) {
            vm.expectRevert(abi.encodeWithSelector(Paynora.RequestExpired.selector, expiry, nowTs));
            p.payRequest(r, sig);
            assertTrue(p.isRequestOpen(bob, id));
        } else {
            p.payRequest(r, sig);
            assertEq(usdc.balanceOf(bob), amount);
            assertEq(usdc.balanceOf(alice), FUNDS - amount);
            assertEq(usdc.balanceOf(address(p)), 0);
            assertFalse(p.isRequestOpen(bob, id));
        }
    }

    function testFuzz_PayRequest_TamperedAmountRejected(uint256 amount, uint256 other) public {
        amount = bound(amount, 1, FUNDS);
        other = bound(other, 1, FUNDS);
        vm.assume(other != amount);
        Paynora.PaymentRequest memory r = _req(bob, amount, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        r.amount = other;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function testFuzz_PayRequest_RandomSignerRejected(uint256 pk) public {
        pk = bound(pk, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(vm.addr(pk) != bob);
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(pk, r);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function testFuzz_PayRequest_ChainIdBinding(uint64 newChain) public {
        vm.assume(newChain != block.chainid && newChain != 0);
        Paynora.PaymentRequest memory r = _req(bob, 1e6, ID1, "x", START + 1 days);
        bytes memory sig = _sign(bobPk, r);
        vm.chainId(newChain);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Paynora.InvalidSignature.selector, bob));
        p.payRequest(r, sig);
    }

    function testFuzz_Cancel_NamespaceIsolation(address a, address b, bytes32 id) public {
        vm.assume(a != b && id != bytes32(0));
        vm.prank(a);
        p.cancelRequest(id);
        assertFalse(p.isRequestOpen(a, id));
        assertTrue(p.isRequestOpen(b, id));
    }
}

// =====================================================================
// Invariants
// =====================================================================

contract PaynoraHandler is Test {
    Paynora public p;
    MockUSDC public usdc;
    address[] public actors;
    uint256[] public keys;

    address[] public closedPayees;
    bytes32[] public closedIds;
    uint256 public successfulPays;
    uint256 public successfulRequests;

    constructor(Paynora _p, MockUSDC _usdc, address[] memory _actors, uint256[] memory _keys) {
        p = _p;
        usdc = _usdc;
        actors = _actors;
        keys = _keys;
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function closedLength() external view returns (uint256) {
        return closedIds.length;
    }

    function pay(uint256 payerSeed, uint256 toSeed, uint256 amount, uint256 noteLen) external {
        address payer = actors[payerSeed % actors.length];
        address to = actors[toSeed % actors.length];
        if (to == payer) return;
        uint256 bal = usdc.balanceOf(payer);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        bytes memory note = new bytes(bound(noteLen, 0, 140));
        vm.prank(payer);
        p.pay(to, amount, string(note));
        successfulPays++;
    }

    function payRequest(uint256 payerSeed, uint256 payeeSeed, uint256 amount, uint256 idSeed, uint256 warpBy)
        external
    {
        uint256 payeeIdx = payeeSeed % actors.length;
        address payer = actors[payerSeed % actors.length];
        address payee = actors[payeeIdx];
        if (payer == payee) return;
        uint256 bal = usdc.balanceOf(payer);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        bytes32 id = bytes32(bound(idSeed, 1, 8)); // small id space => collisions exercise closure
        Paynora.PaymentRequest memory r =
            Paynora.PaymentRequest(payee, amount, id, "req", block.timestamp + bound(warpBy, 0, 1000));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(keys[payeeIdx], p.requestDigest(r));
        vm.prank(payer);
        try p.payRequest(r, abi.encodePacked(rr, s, v)) {
            successfulRequests++;
            closedPayees.push(payee);
            closedIds.push(id);
        } catch {}
    }

    function cancel(uint256 payeeSeed, uint256 idSeed) external {
        address payee = actors[payeeSeed % actors.length];
        bytes32 id = bytes32(bound(idSeed, 1, 8));
        vm.prank(payee);
        try p.cancelRequest(id) {
            closedPayees.push(payee);
            closedIds.push(id);
        } catch {}
    }

    function skipTime(uint256 secs) external {
        skip(bound(secs, 0, 2000));
    }
}

contract PaynoraInvariantTest is PaynoraTestBase {
    PaynoraHandler internal handler;
    address[] internal actorList;
    uint256 internal totalMinted;

    function setUp() public override {
        super.setUp();
        address[] memory a = new address[](4);
        uint256[] memory k = new uint256[](4);
        a[0] = alice; k[0] = alicePk;
        a[1] = bob; k[1] = bobPk;
        a[2] = carol; k[2] = carolPk;
        (a[3], k[3]) = makeAddrAndKey("erin");
        for (uint256 i; i < 4; ++i) {
            actorList.push(a[i]);
            if (a[i] != alice && a[i] != carol) {
                usdc.mint(a[i], FUNDS);
                vm.prank(a[i]);
                usdc.approve(address(p), type(uint256).max);
            }
        }
        // alice, carol, dave were minted FUNDS in base setUp; bob & erin just now.
        totalMinted = usdc.totalSupply();

        handler = new PaynoraHandler(p, usdc, a, k);
        targetContract(address(handler));
    }

    /// Paynora never holds USDC.
    function invariant_PaynoraNeverHoldsUsdc() public view {
        assertEq(usdc.balanceOf(address(p)), 0);
    }

    /// Value is conserved: actor balances (+ dave, who never transacts) sum to the minted supply.
    function invariant_TotalBalancesConserved() public view {
        uint256 sum = usdc.balanceOf(address(p)) + usdc.balanceOf(dave);
        for (uint256 i; i < actorList.length; ++i) {
            sum += usdc.balanceOf(actorList[i]);
        }
        assertEq(sum, totalMinted);
        assertEq(usdc.totalSupply(), totalMinted);
    }

    /// Any (payee, id) that was paid or cancelled stays closed forever (no reopen / replay).
    function invariant_ClosedRequestsStayClosed() public view {
        uint256 n = handler.closedLength();
        for (uint256 i; i < n; ++i) {
            assertFalse(p.isRequestOpen(handler.closedPayees(i), handler.closedIds(i)));
        }
    }
}
