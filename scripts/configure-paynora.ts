/**
 * Verifies a deployed Paynora contract on Arc Mainnet, then writes its address and deploy block to .env.
 *
 *   bun run configure:paynora <contract-address> --tx <deployment-tx-hash>
 *
 * Nothing is written unless every check passes:
 *   - the RPC reports chain ID 5042
 *   - the address has contract code
 *   - eip712Domain() says name "Paynora", version "1", chain 5042 and verifyingContract == the address
 *   - USDC() is the official Arc USDC, MAX_NOTE_BYTES is 140, the request typehash matches
 *   - the deployed runtime code is byte-for-byte the local build of contracts/Paynora.sol (immutables masked)
 *   - the deployment transaction succeeded and created exactly this address (its block becomes the deploy block)
 *
 * Options: --env <path> (default .env), --dry-run (verify only).
 * This script only reads from the chain. It never sends a transaction.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, getAddress, http, isAddress, isHash, keccak256, toHex, type Address } from 'viem'
import { paynoraAbi } from '../src/paynoraAbi'
import { getUsdc, requireChain } from '../src/onchain-facts'
import { checkBytecode } from './lib/paynora-checks'

const ARC_MAINNET = 5042
const chain = requireChain(ARC_MAINNET)
const officialUsdc = getUsdc(ARC_MAINNET)?.address
if (!officialUsdc || chain.isTestnet) throw new Error('Arc Mainnet facts are missing')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const fail = (message: string): never => {
  console.error(`\nNot configured: ${message}`)
  process.exit(1)
}

const input = process.argv[2] ?? ''
if (!isAddress(input)) fail('first argument must be the deployed Paynora contract address (0x…)')
const address: Address = getAddress(input)
const txHash = arg('--tx')
const envPath = arg('--env') ?? '.env'
const dryRun = process.argv.includes('--dry-run')
if (!txHash || !isHash(txHash)) fail('pass the deployment transaction hash with --tx 0x… so the deploy block can be verified')

// RPC: explicit override, else the sandbox proxy for Arc, else the public RPC from the facts module.
const proxied = (process.env.RPC_PROXY_CHAINS ?? '').split(',').includes('Arc')
const rpcUrl =
  process.env.RPC_URL_Arc ??
  (proxied && process.env.RPC_PROXY_BASE_URL ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}` : chain.rpcUrls[0])
const client = createPublicClient({ transport: http(rpcUrl) })

const reportedChain = await client.getChainId()
if (reportedChain !== ARC_MAINNET) fail(`the RPC reports chain ID ${reportedChain}, expected ${ARC_MAINNET} (Arc Mainnet)`)
console.log(`RPC chain ID ${reportedChain} (Arc Mainnet)`)

const code = await client.getCode({ address })
if (!code || code === '0x') fail(`no contract code at ${address} on Arc Mainnet`)

const read = async <T>(fn: () => Promise<T>, what: string): Promise<T> => {
  try {
    return await fn()
  } catch {
    return fail(`${address} does not look like Paynora (could not read ${what})`)
  }
}

const domain = await read(() => client.readContract({ address, abi: paynoraAbi, functionName: 'eip712Domain' }), 'eip712Domain()')
const [, name, version, domainChain, verifying] = domain
if (name !== 'Paynora' || version !== '1') fail(`EIP-712 domain is "${name}" v${version}, expected "Paynora" v1`)
if (Number(domainChain) !== ARC_MAINNET) fail(`contract domain chain is ${domainChain}, expected ${ARC_MAINNET}`)
if (getAddress(verifying) !== address) fail('contract domain verifyingContract does not match the address')

const usdc = await read(() => client.readContract({ address, abi: paynoraAbi, functionName: 'USDC' }), 'USDC()')
if (getAddress(usdc) !== getAddress(officialUsdc)) fail(`contract USDC is ${usdc}, expected the official Arc USDC ${officialUsdc}`)
const maxNote = await read(() => client.readContract({ address, abi: paynoraAbi, functionName: 'MAX_NOTE_BYTES' }), 'MAX_NOTE_BYTES()')
if (maxNote !== 140n) fail(`MAX_NOTE_BYTES is ${maxNote}, expected 140`)
const typehash = await read(() => client.readContract({ address, abi: paynoraAbi, functionName: 'PAYMENT_REQUEST_TYPEHASH' }), 'PAYMENT_REQUEST_TYPEHASH()')
const expected = keccak256(toHex('PaymentRequest(address payee,uint256 amount,bytes32 requestId,string note,uint256 expiry)'))
if (typehash !== expected) fail('PAYMENT_REQUEST_TYPEHASH does not match the app (different contract version)')
console.log('Contract identity verified (Paynora v1, official Arc USDC, request typehash)')

const bytecode = await checkBytecode(client, address)
if (!bytecode.ok) fail(bytecode.message)
console.log(bytecode.message)

const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => undefined)
if (!receipt) fail('the deployment transaction was not found on Arc Mainnet')
if (receipt!.status !== 'success') fail('the deployment transaction did not succeed')
if (!receipt!.contractAddress || getAddress(receipt!.contractAddress) !== address) {
  fail(`the transaction did not create ${address} (it created ${receipt!.contractAddress ?? 'no contract'})`)
}
const deployBlock = receipt!.blockNumber
console.log(`Deployed in block ${deployBlock}`)

if (dryRun) {
  console.log('\nDry run: all checks passed. .env was not changed.')
  process.exit(0)
}

let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
const upsert = (key: string, value: string) => {
  const line = `${key}=${value}`
  env = new RegExp(`^${key}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${env.replace(/\n*$/, '\n')}${line}\n`
}
upsert('VITE_PAYNORA_ADDRESS', address)
upsert('VITE_PAYNORA_DEPLOY_BLOCK', deployBlock.toString())
writeFileSync(envPath, env)
console.log(`\nWrote VITE_PAYNORA_ADDRESS and VITE_PAYNORA_DEPLOY_BLOCK to ${envPath}.`)
console.log('Vite restarts on .env changes; reload the Preview. Run "bun run dev" again if the dev server is not running.')
