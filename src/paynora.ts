/**
 * Paynora deployment configuration.
 *
 * Chain, USDC and explorer facts are read from the generated onchain facts module.
 * The Paynora contract address is NOT known until you deploy contracts/Paynora.sol:
 * set VITE_PAYNORA_ADDRESS (and VITE_PAYNORA_DEPLOY_BLOCK) in .env, then restart the dev server.
 */

import { getAddress, isAddress, type Address } from 'viem'
import { ARC_MAINNET_ID } from './config'
import { TEST_MODE } from './mode'
import { TEST_DEPLOY_BLOCK, TEST_PAYNORA_ADDRESS } from './testChain'
import { buildAddressExplorerUrl, buildTxExplorerUrl, getUsdc, requireChain } from './onchain-facts'

export const CHAIN_ID = ARC_MAINNET_ID
export const CHAIN = requireChain(CHAIN_ID)

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error('Arc Mainnet USDC is missing from onchain facts')
export const USDC_ADDRESS = getAddress(usdcFact.address)
export const USDC_DECIMALS = usdcFact.decimals

/** Matches Paynora.MAX_NOTE_BYTES. */
export const MAX_NOTE_BYTES = 140

const rawAddress = (import.meta.env.VITE_PAYNORA_ADDRESS ?? '').trim()
const rawDeployBlock = (import.meta.env.VITE_PAYNORA_DEPLOY_BLOCK ?? '').trim()

/** The Paynora contract in use: your Arc Mainnet deployment, or the local test chain's in Test Mode. */
export const PAYNORA_ADDRESS: Address | undefined = TEST_MODE ? TEST_PAYNORA_ADDRESS : isAddress(rawAddress) ? getAddress(rawAddress) : undefined

/** Block the contract was deployed at. Event scans never start before it. */
export const PAYNORA_DEPLOY_BLOCK: bigint | undefined = TEST_MODE ? TEST_DEPLOY_BLOCK : /^\d+$/.test(rawDeployBlock) ? BigInt(rawDeployBlock) : undefined

export const configProblem: string | undefined = TEST_MODE
  ? undefined
  : !rawAddress
    ? 'The Paynora contract is not configured yet.'
    : !isAddress(rawAddress)
      ? 'VITE_PAYNORA_ADDRESS is not a valid address.'
      : PAYNORA_DEPLOY_BLOCK === undefined
        ? 'VITE_PAYNORA_DEPLOY_BLOCK is missing. Set it to the block the contract was deployed at.'
        : undefined

/** Name shown for the network the app is reading. */
export const NETWORK_NAME = TEST_MODE ? 'Test chain' : CHAIN.name

/** Explorer links exist only on Arc Mainnet. The local test chain has no explorer. */
export const txUrl = (hash: string): string | undefined => (TEST_MODE ? undefined : buildTxExplorerUrl(CHAIN_ID, hash))
export const addressUrl = (address: string): string | undefined => (TEST_MODE ? undefined : buildAddressExplorerUrl(CHAIN_ID, address))
