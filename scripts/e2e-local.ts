/**
 * Local end-to-end check of Paynora's browser-side logic against the real contract bytecode.
 *
 * Starts nothing itself: run `anvil --chain-id 5042 --port 8555` first, then
 *   bun run scripts/e2e-local.ts
 * It etches a 6-decimal test token at the Arc USDC address on the LOCAL anvil node only, deploys
 * contracts/Paynora.sol there, then exercises approve -> pay, signed request -> payRequest,
 * cancel, and the same receipt verification rules the app uses. Nothing touches Arc Mainnet.
 */
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, erc20Abi, http, parseEventLogs, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { paynoraAbi } from '../src/paynoraAbi'

const RPC = 'http://127.0.0.1:8555'
const USDC = '0x3600000000000000000000000000000000000000' as const
const chain = { id: 5042, name: 'local', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const

const mock = JSON.parse(readFileSync('contracts/out/Paynora.t.sol/MockUSDC.json', 'utf8')) as { deployedBytecode: { object: Hex } }
const paynoraArtifact = JSON.parse(readFileSync('contracts/out/Paynora.sol/Paynora.json', 'utf8')) as { bytecode: { object: Hex } }

const pub = createPublicClient({ chain, transport: http(RPC) })
const payer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const payee = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const payerClient = createWalletClient({ account: payer, chain, transport: http(RPC) })
const payeeClient = createWalletClient({ account: payee, chain, transport: http(RPC) })

const id = (byte: string): Hex => `0x${byte.repeat(32)}`
const rpc = (method: string, params: unknown[]) => pub.request({ method, params } as never)
await rpc('anvil_setCode', [USDC, mock.deployedBytecode.object])

const deployHash = await payerClient.deployContract({ abi: paynoraAbi, bytecode: paynoraArtifact.bytecode.object })
const deployed = await pub.waitForTransactionReceipt({ hash: deployHash })
const paynora = deployed.contractAddress!
console.log('Paynora deployed at', paynora)

const mockAbi = [{ type: 'function', name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }] as const
await pub.waitForTransactionReceipt({ hash: await payerClient.writeContract({ address: USDC, abi: mockAbi, functionName: 'mint', args: [payer.address, 1_000_000_000n] }) })

let failures = 0
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

// 1. Direct payment, exact-amount approval.
const amount = 2_500_000n
await pub.waitForTransactionReceipt({ hash: await payerClient.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [paynora, amount] }) })
const payHash = await payerClient.writeContract({ address: paynora, abi: paynoraAbi, functionName: 'pay', args: [payee.address, amount, 'coffee'] })
const payReceipt = await pub.waitForTransactionReceipt({ hash: payHash })
const sent = parseEventLogs({ abi: paynoraAbi, logs: payReceipt.logs, eventName: 'PaymentSent' })[0]
check('pay: receipt success', payReceipt.status === 'success')
check('pay: PaymentSent matches expected from/to/amount/note', sent.args.from === payer.address && sent.args.to === payee.address && sent.args.amount === amount && sent.args.note === 'coffee' && /^0x0+$/.test(sent.args.requestId))
check('pay: payee received funds, Paynora holds none', (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [payee.address] })) === amount && (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [paynora] })) === 0n)

// 2. Signed request, typed data exactly as the app builds it.
const requestTypes = {
  PaymentRequest: [
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'requestId', type: 'bytes32' },
    { name: 'note', type: 'string' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const
const domain = { name: 'Paynora', version: '1', chainId: 5042, verifyingContract: paynora } as const
const latest = await pub.getBlock()
const request = { payee: payee.address, amount: 1_000_000n, requestId: id('ab'), note: 'invoice 42', expiry: latest.timestamp + 3600n }
const signature = await payeeClient.signTypedData({ domain, types: requestTypes, primaryType: 'PaymentRequest', message: request })
check('request: client verifyTypedData accepts signature', await pub.verifyTypedData({ address: payee.address, domain, types: requestTypes, primaryType: 'PaymentRequest', message: request, signature }))
check('request: isRequestOpen before payment', (await pub.readContract({ address: paynora, abi: paynoraAbi, functionName: 'isRequestOpen', args: [payee.address, request.requestId] })) === true)

await pub.waitForTransactionReceipt({ hash: await payerClient.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [paynora, request.amount] }) })
const reqHash = await payerClient.writeContract({ address: paynora, abi: paynoraAbi, functionName: 'payRequest', args: [request, signature] })
const reqReceipt = await pub.waitForTransactionReceipt({ hash: reqHash })
const reqEvent = parseEventLogs({ abi: paynoraAbi, logs: reqReceipt.logs, eventName: 'PaymentSent' })[0]
check('request: payRequest succeeds with app-signed typed data', reqReceipt.status === 'success')
check('request: event carries requestId, exact amount and note', reqEvent.args.requestId === request.requestId && reqEvent.args.amount === request.amount && reqEvent.args.note === request.note)
check('request: closed after payment', (await pub.readContract({ address: paynora, abi: paynoraAbi, functionName: 'isRequestOpen', args: [payee.address, request.requestId] })) === false)

let replayRejected = false
try {
  await pub.simulateContract({ account: payer, address: paynora, abi: paynoraAbi, functionName: 'payRequest', args: [request, signature] })
} catch {
  replayRejected = true
}
check('request: replay is rejected', replayRejected)

// 3. Tampered amount must fail.
const forged = { ...request, requestId: id('cd'), amount: 1n }
const forgedSig = await payeeClient.signTypedData({ domain, types: requestTypes, primaryType: 'PaymentRequest', message: { ...forged, amount: 5n } })
let tamperRejected = false
try {
  await pub.simulateContract({ account: payer, address: paynora, abi: paynoraAbi, functionName: 'payRequest', args: [forged, forgedSig] })
} catch {
  tamperRejected = true
}
check('request: amount tampering is rejected', tamperRejected)

// 4. Cancellation.
const cancelId = id('ef')
await pub.waitForTransactionReceipt({ hash: await payeeClient.writeContract({ address: paynora, abi: paynoraAbi, functionName: 'cancelRequest', args: [cancelId] }) })
check('cancel: request closed', (await pub.readContract({ address: paynora, abi: paynoraAbi, functionName: 'isRequestOpen', args: [payee.address, cancelId] })) === false)

// 5. Indexer query shape: indexed from/to filters over the deploy block range.
const logsSent = await pub.getLogs({ address: paynora, event: paynoraAbi.find((x) => x.type === 'event' && x.name === 'PaymentSent')!, args: { from: payer.address }, fromBlock: deployed.blockNumber, toBlock: 'latest', strict: true })
const logsRecv = await pub.getLogs({ address: paynora, event: paynoraAbi.find((x) => x.type === 'event' && x.name === 'PaymentSent')!, args: { to: payee.address }, fromBlock: deployed.blockNumber, toBlock: 'latest', strict: true })
check('indexer: sent filter finds both payments', logsSent.length === 2)
check('indexer: received filter finds both payments', logsRecv.length === 2)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
