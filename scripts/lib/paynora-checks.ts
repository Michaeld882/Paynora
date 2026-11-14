/**
 * Read-only checks shared by the Paynora deployment scripts. Nothing here sends a transaction.
 */
import { existsSync, readFileSync } from 'node:fs'
import { getAddress, keccak256, toHex, type Address, type Hex, type PublicClient } from 'viem'
import { paynoraAbi } from '../../src/paynoraAbi'
import { getUsdc, requireChain } from '../../src/onchain-facts'

export const ARC_MAINNET = 5042
export const ARTIFACT_PATH = 'contracts/out/Paynora.sol/Paynora.json'

export const chainFacts = requireChain(ARC_MAINNET)
export const officialUsdc = getUsdc(ARC_MAINNET)?.address
if (!officialUsdc || chainFacts.isTestnet) throw new Error('Arc Mainnet facts are missing')

/** Arc RPC: explicit override, else the sandbox proxy for Arc, else the public RPC from the facts module. */
export function arcRpcUrl(): string {
  const proxied = (process.env.RPC_PROXY_CHAINS ?? '').split(',').includes('Arc')
  return (
    process.env.RPC_URL_Arc ??
    (proxied && process.env.RPC_PROXY_BASE_URL
      ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`
      : chainFacts.rpcUrls[0])
  )
}

export type CheckResult = { ok: true; message: string } | { ok: false; message: string }

/** The address is a Paynora v1 contract for Arc Mainnet that pays out the official Arc USDC. */
export async function checkIdentity(client: PublicClient, address: Address): Promise<CheckResult> {
  try {
    const [, name, version, domainChain, verifying] = await client.readContract({ address, abi: paynoraAbi, functionName: 'eip712Domain' })
    if (name !== 'Paynora' || version !== '1') return { ok: false, message: `EIP-712 domain is "${name}" v${version}, expected "Paynora" v1` }
    if (Number(domainChain) !== ARC_MAINNET) return { ok: false, message: `contract domain chain is ${domainChain}, expected ${ARC_MAINNET}` }
    if (getAddress(verifying) !== address) return { ok: false, message: 'contract domain verifyingContract does not match the address' }
    const usdc = await client.readContract({ address, abi: paynoraAbi, functionName: 'USDC' })
    if (getAddress(usdc) !== getAddress(officialUsdc as string)) return { ok: false, message: `contract USDC is ${usdc}, expected the official Arc USDC ${officialUsdc}` }
    const maxNote = await client.readContract({ address, abi: paynoraAbi, functionName: 'MAX_NOTE_BYTES' })
    if (maxNote !== 140n) return { ok: false, message: `MAX_NOTE_BYTES is ${maxNote}, expected 140` }
    const typehash = await client.readContract({ address, abi: paynoraAbi, functionName: 'PAYMENT_REQUEST_TYPEHASH' })
    const expected = keccak256(toHex('PaymentRequest(address payee,uint256 amount,bytes32 requestId,string note,uint256 expiry)'))
    if (typehash !== expected) return { ok: false, message: 'PAYMENT_REQUEST_TYPEHASH does not match the app (different contract version)' }
    return { ok: true, message: 'Contract identity verified (Paynora v1, chain 5042, official Arc USDC, request typehash)' }
  } catch {
    return { ok: false, message: `${address} does not look like Paynora (could not read its identity)` }
  }
}

type ImmutableRefs = Record<string, { start: number; length: number }[]>

/** Zeroes the immutable slots (domain separator, cached address, ...) so two deployments compare equal. */
function maskImmutables(code: Hex, refs: ImmutableRefs): string {
  const bytes = code.slice(2).split('')
  for (const ranges of Object.values(refs)) {
    for (const { start, length } of ranges) {
      for (let i = start * 2; i < (start + length) * 2; i++) bytes[i] = '0'
    }
  }
  return bytes.join('')
}

/**
 * The runtime code at the address is byte-for-byte the local build of contracts/Paynora.sol, ignoring
 * only the immutable slots the constructor fills in. Run `bun run contracts:build` first.
 */
export async function checkBytecode(client: PublicClient, address: Address): Promise<CheckResult> {
  if (!existsSync(ARTIFACT_PATH)) {
    return { ok: false, message: `${ARTIFACT_PATH} not found. Run "bun run contracts:build" so the deployed code can be compared with the source.` }
  }
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as { deployedBytecode: { object: Hex; immutableReferences?: ImmutableRefs } }
  const local = artifact.deployedBytecode.object
  const refs = artifact.deployedBytecode.immutableReferences ?? {}
  const onchain = await client.getCode({ address })
  if (!onchain || onchain === '0x') return { ok: false, message: `no contract code at ${address}` }
  if (onchain.length !== local.length) {
    return { ok: false, message: 'the deployed code has a different length than your local build. It was compiled from a different source or compiler settings. Rebuild with "bun run contracts:build" and redeploy.' }
  }
  const same = maskImmutables(onchain, refs) === maskImmutables(local, refs)
  if (!same) {
    return { ok: false, message: 'the deployed code does not match your local build of contracts/Paynora.sol (different source or compiler settings).' }
  }
  return {
    ok: true,
    message: `Deployed code matches contracts/Paynora.sol (${(onchain.length - 2) / 2} bytes, code hash ${keccak256(onchain).slice(0, 18)}…)`,
  }
}
