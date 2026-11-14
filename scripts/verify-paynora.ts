/**
 * Read-only audit of the configured Paynora deployment on Arc Mainnet. Never sends a transaction.
 *
 *   bun run verify:paynora
 *
 * Reads VITE_PAYNORA_ADDRESS and VITE_PAYNORA_DEPLOY_BLOCK (bun loads .env), checks the chain,
 * the deployed code and the contract identity, then scans the contract's real events to show
 * which flows have happened onchain: approvals to Paynora, direct payments, request payments
 * and cancellations. Use it after your own first small mainnet payments.
 */
import { createPublicClient, getAbiItem, getAddress, http, isAddress, parseAbiItem, type Address } from 'viem'
import { paynoraAbi } from '../src/paynoraAbi'
import { buildTxExplorerUrl } from '../src/onchain-facts'
import { ARC_MAINNET, arcRpcUrl, checkBytecode, checkIdentity, officialUsdc } from './lib/paynora-checks'

const fail = (message: string): never => {
  console.error(`\nNot verified: ${message}`)
  process.exit(1)
}

const rawAddress = (process.env.VITE_PAYNORA_ADDRESS ?? '').trim()
const rawBlock = (process.env.VITE_PAYNORA_DEPLOY_BLOCK ?? '').trim()
if (!isAddress(rawAddress) || !/^\d+$/.test(rawBlock)) {
  fail('VITE_PAYNORA_ADDRESS / VITE_PAYNORA_DEPLOY_BLOCK are not set. Deploy the contract, then run: bun run configure:paynora <address> --tx <deploy-tx-hash>')
}
const address: Address = getAddress(rawAddress)
const deployBlock = BigInt(rawBlock)

const client = createPublicClient({ transport: http(arcRpcUrl()) })
const reported = await client.getChainId()
if (reported !== ARC_MAINNET) fail(`the RPC reports chain ID ${reported}, expected ${ARC_MAINNET}`)
console.log(`RPC chain ID ${reported} (Arc Mainnet)`)

const identity = await checkIdentity(client, address)
if (!identity.ok) fail(identity.message)
console.log(identity.message)
const bytecode = await checkBytecode(client, address)
if (!bytecode.ok) fail(bytecode.message)
console.log(bytecode.message)

const paymentEvent = getAbiItem({ abi: paynoraAbi, name: 'PaymentSent' })
const cancelEvent = getAbiItem({ abi: paynoraAbi, name: 'RequestCancelled' })
const approvalEvent = parseAbiItem('event Approval(address indexed owner, address indexed spender, uint256 value)')
const zeroId = `0x${'0'.repeat(64)}`

const head = await client.getBlockNumber()
const CHUNK = 5000n
const direct: string[] = []
const requests: string[] = []
let cancellations = 0
let approvals = 0
for (let from = deployBlock; from <= head; from += CHUNK) {
  const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n
  const [payments, cancels, approves] = await Promise.all([
    client.getLogs({ address, event: paymentEvent, fromBlock: from, toBlock: to, strict: true }),
    client.getLogs({ address, event: cancelEvent, fromBlock: from, toBlock: to, strict: true }),
    client.getLogs({ address: getAddress(officialUsdc as string), event: approvalEvent, args: { spender: address }, fromBlock: from, toBlock: to, strict: true }),
  ])
  for (const log of payments) (log.args.requestId === zeroId ? direct : requests).push(log.transactionHash)
  cancellations += cancels.length
  approvals += approves.length
}

const mark = (n: number) => (n > 0 ? `yes (${n})` : 'not yet')
console.log(`\nOnchain evidence on Arc Mainnet, blocks ${deployBlock} to ${head}:`)
console.log(`  USDC approvals to Paynora : ${mark(approvals)}`)
console.log(`  Direct payments (pay)     : ${mark(direct.length)}`)
console.log(`  Request payments          : ${mark(requests.length)}`)
console.log(`  Request cancellations     : ${mark(cancellations)}`)
for (const hash of [...direct.slice(-3), ...requests.slice(-3)]) console.log(`  ${buildTxExplorerUrl(ARC_MAINNET, hash)}`)
if (direct.length === 0 || requests.length === 0) {
  console.log('\nThe mainnet flow is NOT fully exercised yet. Send a small direct payment and pay one request from two wallets, then run this again.')
} else {
  console.log('\nBoth payment flows have confirmed events onchain. Review the transactions above on the explorer.')
}
