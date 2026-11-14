/**
 * wagmi configuration: Arc Mainnet only.
 * Chain id, RPC and explorer come from the generated onchain facts, never typed here.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'
import { TEST_MODE } from './mode'
import { TEST_RPC_PATH } from './testChain'
import { testProvider } from './testWallet'
import { requireChain } from './onchain-facts'
import { registerChain } from './tracing'

export const ARC_MAINNET_ID = 5042

const facts = requireChain(ARC_MAINNET_ID)
if (facts.isTestnet || !facts.usdc) {
  throw new Error('Paynora requires Arc Mainnet facts with a USDC contract')
}

export const arcMainnet = defineChain({
  id: facts.chainId,
  name: 'Arc Mainnet',
  nativeCurrency: {
    name: facts.nativeCurrency.symbol,
    symbol: facts.nativeCurrency.symbol,
    decimals: facts.nativeCurrency.decimals,
  },
  rpcUrls: { default: { http: TEST_MODE ? [`${window.location.origin}${TEST_RPC_PATH}`] : [...facts.rpcUrls] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: facts.explorerBase } },
})

registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcMainnet],
  // Test Mode swaps the wallet and RPC for the local test chain. Production builds compile this away.
  connectors: [
    TEST_MODE
      ? injected({ target: () => ({ id: 'paynoraTestWallet', name: 'Preview test wallet', provider: testProvider as never }) })
      : injected(),
  ],
  transports: { [arcMainnet.id]: http(arcMainnet.rpcUrls.default.http[0]) },
})
