# Paynora

> Built with Arc Studio - money-powered apps in minutes

Project memory for future agents and humans.

## What this app does

Paynora is a mobile-first USDC payment app on Arc Mainnet (chain 5042): Pay, Request (payee-signed EIP-712 links and QR), Receive, Activity and a Dashboard. Success is shown only after receipt verification plus a matching `PaymentSent` event.

## Tech stack

- Frontend: React 18, Vite, TypeScript, Tailwind (class dark mode, CSS variable tokens in `src/index.css`)
- Web3: wagmi v2, viem, ConnectKit (injected connector only), Arc Mainnet only
- Contract: `contracts/Paynora.sol` (single custom contract, no admin, no fees, non-custodial), tests in `contracts/test/Paynora.t.sol`
- Chain facts: always import from `@/onchain-facts` and `@/onchain-money`, never retype them

## Deployment status

- Paynora contract: NOT DEPLOYED. No address exists. After a user deploys it from their own wallet they run `bun run configure:paynora <address> --tx <deploy-tx>`, which verifies it onchain and writes `VITE_PAYNORA_ADDRESS` and `VITE_PAYNORA_DEPLOY_BLOCK` to `.env`. Never invent or guess these values.
- Arc Studio does not deploy to or transact on mainnet.

## Key files

- `src/paynora.ts` - chain, USDC and contract configuration (reads the two VITE_ vars)
- `src/paynoraAbi.ts` - generated from `contracts/out/Paynora.sol/Paynora.json`; regenerate after contract changes
- `src/hooks/usePayment.ts` - approve (exact amount) then pay flow; `src/lib/verify.ts` - receipt verification
- `src/hooks/ActivityProvider.tsx` - event indexer (starts at the deploy block, never block 0) and pending-transaction recovery
- `src/lib/pending.ts` - local journal of submitted transactions (UI state only, resolved against receipts)
- `src/lib/requests.ts` - request typed data, link encoding, local request list
- `scripts/e2e-local.ts` - local anvil end-to-end check
- `scripts/configure-paynora.ts` - verifies a deployment and writes the two VITE_PAYNORA_* values
- `src/components/PaymentOverview.tsx` - dashboard counts (total, successful, pending, failed) derived only from chain events and this wallet's receipts

## Notes

- Log queries use 5,000-block chunks (measured working on the Arc RPC; 10,000 was rejected as too large) and halve the range on a range error.
- Request links carry a payee signature in the query (`v`). It authorises payment, it is not a secret. Never put real secrets in links.
- Native gas and USDC are one pool on Arc: show a single USDC balance (6-decimal ERC-20 view).

- Do not wrap the routed page in AnimatePresence with an exit animation: the router renders the new route inside the exiting page, mounting it twice and wiping form input (found in a real-browser test).
- Browser end-to-end test recipe: local anvil on chain id 5042, mock 6-decimal token etched at the USDC address, build with VITE_PAYNORA_ADDRESS/VITE_PAYNORA_DEPLOY_BLOCK passed as shell env (never written to .env), mock injected wallet, and the Arc RPC route-intercepted to anvil.

- Preview Test Mode (dev only, `src/mode.ts`): active while `VITE_PAYNORA_ADDRESS` is empty. Local anvil test chain via `bun run test-chain`, proxied by Vite at `/test-chain`; in-app test wallet in `src/testWallet.ts`; constants in `src/testChain.ts`. Not Arc Mainnet. Production builds compile it out. `NETWORK_NAME`, `txUrl` and `addressUrl` in `src/paynora.ts` adapt to it (no explorer on the test chain).
- Dashboard actions are Send and Request (no Quick Pay). Receive has a Payment link (`/pay?to=&amt=&memo=`, unsigned prefill only).

- Mainnet readiness: `.env` sets `VITE_PAYNORA_TEST_MODE=off`, so the Preview uses real Arc Mainnet configuration only. Deployment is done by the user (`forge create`), then `bun run configure:paynora <address> --tx <hash>` (adds a byte-for-byte code check against `contracts/out`), then `bun run verify:paynora` after real payments. No mainnet address exists yet; never invent one.
