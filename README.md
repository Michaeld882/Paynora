# Paynora

Fast, transparent USDC payments on Arc Mainnet. Send money to any wallet, request an exact amount with a shareable link or QR code, and see real payment activity. Paynora never holds your funds, and a payment is only shown as successful after its receipt and payment event are verified onchain.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React 18, Vite, TypeScript, Tailwind CSS
- wagmi, viem, ConnectKit (injected wallets such as MetaMask)
- Solidity 0.8.28 and Foundry, with OpenZeppelin (`contracts/Paynora.sol`)

## Network

Arc Mainnet only. Chain ID, RPC, explorer and the USDC address are read from `src/onchain-facts.ts`, so they stay consistent across the app.

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://book.getfoundry.sh).

```bash
bun install
bun run dev          # start the app
bun run check        # lint and typecheck
bun run contracts:build
bun run contracts:test
```

### Environment variables

| Name | Purpose |
| --- | --- |
| `VITE_PAYNORA_ADDRESS` | Address of your deployed Paynora contract on Arc Mainnet. |
| `VITE_PAYNORA_DEPLOY_BLOCK` | Block number the contract was deployed at. Activity scans start here. |

Until both are set, the app shows "Paynora contract not configured" and disables payments, requests and activity. Balance, receive address and network status still work.

## Preview Test Mode (development only)

When `VITE_PAYNORA_TEST_MODE` is not `off` and no real contract is configured, the dev server runs Paynora in Test Mode so Pay, Request, Receive and Activity can be tried end to end. It uses a local test chain (`bun run test-chain`, chain ID 5042, real contract code and real transactions), a built-in test wallet with two accounts, and worthless test USDC. It never shows Arc Mainnet data, a banner says so on every page, and the chain resets when it restarts. Test Mode is compiled out of production builds and switches off as soon as `VITE_PAYNORA_ADDRESS` is set (or when `VITE_PAYNORA_TEST_MODE=off`).

```bash
bun run test-chain   # starts the local test chain and deploys the contract to it
bun run dev
```

## Deploying and configuring the contract (Arc Mainnet)

You deploy from your own wallet, outside Arc Studio. Mainnet transactions are irreversible. Review the contract and test with small amounts first.

```bash
# 1. Build (the same compiler settings are used to verify the deployment later)
bun run contracts:build

# 2. Deploy. Keep the key in an environment variable or a Foundry keystore, never in a file.
forge create contracts/Paynora.sol:Paynora \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key "$PRIVATE_KEY" \
  --broadcast

# 3. Verify and configure with the address and transaction hash that step 2 prints
bun run configure:paynora <contract-address> --tx <deployment-tx-hash>

# 4. After your first real payments, check what happened onchain
bun run verify:paynora
```

`configure:paynora` only reads from the chain. It requires chain ID 5042, the Paynora v1 identity with the official Arc USDC, deployed code that is byte-for-byte your build of `contracts/Paynora.sol` (immutable slots ignored), and a successful deployment transaction that created exactly that address. Only then does it write `VITE_PAYNORA_ADDRESS` and `VITE_PAYNORA_DEPLOY_BLOCK` to `.env`. Vite restarts on `.env` changes; reload the page. Add `--dry-run` to verify without writing.

`verify:paynora` re-checks the configured deployment and lists the real events it finds: USDC approvals to Paynora, direct payments, request payments and cancellations, with explorer links.

Until the contract is configured, the app shows "Paynora contract not configured" and disables payments, requests and activity. Balance, receive address and network status still work.

## Local end-to-end check

`scripts/e2e-local.ts` runs the app's payment, signed-request and cancel logic against the real contract bytecode on a local node. It never touches mainnet.

```bash
anvil --chain-id 5042 --port 8555 --silent &
bun run contracts:build && bun run scripts/e2e-local.ts
```
