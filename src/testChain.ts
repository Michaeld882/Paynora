/**
 * Constants for the LOCAL Preview test chain (see src/mode.ts and scripts/test-chain.ts).
 * Nothing here exists on Arc Mainnet. The addresses are the well-known, public development
 * accounts of the local test node, and the contract address is simply where the first
 * deployment from the test node's first account lands. They have no value on any real network.
 */
import type { Address } from 'viem'

/** Dev-server proxy path to the local test node. */
export const TEST_RPC_PATH = '/test-chain'
export const TEST_RPC_TARGET = 'http://127.0.0.1:8545'

export const TEST_DEPLOYER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
export const TEST_PAYNORA_ADDRESS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
export const TEST_DEPLOY_BLOCK = 1n

export const TEST_ACCOUNTS = [
  { label: 'Account A', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  { label: 'Account B', address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
] as const satisfies readonly { label: string; address: Address }[]

/** Test USDC minted to each test account when the chain is set up (6 decimals). */
export const TEST_MINT_RAW = 1_000_000_000n
