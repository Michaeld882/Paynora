/**
 * Preview Test Mode switch.
 *
 * Test Mode exists only on the Vite dev server (it is compiled out of production builds) and only
 * while no real Paynora contract is configured. It points the app at a LOCAL test chain run by
 * `bun run test-chain`, with an in-app test wallet and worthless test USDC. It never shows Arc
 * Mainnet data, and it switches itself off as soon as VITE_PAYNORA_ADDRESS is set.
 * Set VITE_PAYNORA_TEST_MODE=off to disable it explicitly.
 */
const configuredAddress = (import.meta.env.VITE_PAYNORA_ADDRESS ?? '').trim()
const flag = (import.meta.env.VITE_PAYNORA_TEST_MODE ?? '').trim().toLowerCase()

export const TEST_MODE: boolean = import.meta.env.DEV && configuredAddress === '' && flag !== 'off'
