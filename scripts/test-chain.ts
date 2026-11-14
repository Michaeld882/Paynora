/**
 * Local Preview test chain for Paynora Test Mode.
 *
 *   bun run test-chain
 *
 * Starts a throwaway local node (chain ID 5042, port 8545) and deploys the real Paynora contract plus a
 * worthless 6-decimal test token at the USDC address, then mints test USDC to the two test accounts.
 * The dev server proxies it at /test-chain. Nothing here touches Arc Mainnet or any real network.
 * If a test chain is already running it is reused (and set up if needed).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from 'viem'
import { paynoraAbi } from '../src/paynoraAbi'
import { getUsdc } from '../src/onchain-facts'
import { TEST_ACCOUNTS, TEST_DEPLOYER, TEST_DEPLOY_BLOCK, TEST_MINT_RAW, TEST_PAYNORA_ADDRESS, TEST_RPC_TARGET } from '../src/testChain'

const CHAIN_ID = 5042
const usdcRaw = getUsdc(CHAIN_ID)?.address
if (!usdcRaw) throw new Error('Arc USDC address missing from onchain facts')
const USDC = getAddress(usdcRaw)

const chain = { id: CHAIN_ID, name: 'Paynora test chain', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [TEST_RPC_TARGET] } } } as const
const pub = createPublicClient({ chain, transport: http(TEST_RPC_TARGET) })

const online = async () => {
  try {
    return (await pub.getChainId()) === CHAIN_ID
  } catch {
    return false
  }
}

let anvil: ReturnType<typeof spawn> | undefined
if (await online()) {
  console.log(`Test chain already running at ${TEST_RPC_TARGET}`)
} else {
  anvil = spawn('anvil', ['--chain-id', String(CHAIN_ID), '--port', '8545', '--silent'], { stdio: 'ignore' })
  anvil.on('exit', (code) => {
    console.log(`Test chain stopped (${code ?? 'signal'}).`)
    process.exit(code ?? 0)
  })
  for (let i = 0; i < 40 && !(await online()); i++) await new Promise((r) => setTimeout(r, 250))
  if (!(await online())) {
    console.error('Could not start anvil. Is Foundry installed?')
    process.exit(1)
  }
  console.log(`Started test chain (chain ID ${CHAIN_ID}) at ${TEST_RPC_TARGET}`)
}

const artifacts = ['contracts/out/Paynora.sol/Paynora.json', 'contracts/out/Paynora.t.sol/MockUSDC.json']
if (!artifacts.every(existsSync)) {
  console.log('Building contracts…')
  if (spawnSync('forge', ['build'], { stdio: 'inherit' }).status !== 0) process.exit(1)
}

const existing = await pub.getCode({ address: TEST_PAYNORA_ADDRESS })
if (existing && existing !== '0x') {
  console.log(`Paynora already deployed on the test chain at ${TEST_PAYNORA_ADDRESS}`)
} else {
  const paynora = JSON.parse(readFileSync(artifacts[0], 'utf8')) as { bytecode: { object: Hex } }
  const token = JSON.parse(readFileSync(artifacts[1], 'utf8')) as { deployedBytecode: { object: Hex } }
  const wallet = createWalletClient({ account: TEST_DEPLOYER, chain, transport: http(TEST_RPC_TARGET) })

  await pub.request({ method: 'anvil_setCode', params: [USDC, token.deployedBytecode.object] } as never)
  const hash = await wallet.deployContract({ abi: paynoraAbi, bytecode: paynora.bytecode.object })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress || getAddress(receipt.contractAddress) !== getAddress(TEST_PAYNORA_ADDRESS) || receipt.blockNumber !== TEST_DEPLOY_BLOCK) {
    console.error(`Unexpected deployment (${receipt.contractAddress} in block ${receipt.blockNumber}). Restart with a fresh chain.`)
    process.exit(1)
  }
  const mintAbi = [{ type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] }] as const
  for (const account of TEST_ACCOUNTS) {
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: USDC, abi: mintAbi, functionName: 'mint', args: [account.address, TEST_MINT_RAW] }) })
  }
  console.log(`Deployed Paynora at ${TEST_PAYNORA_ADDRESS} (block ${receipt.blockNumber}) and minted test USDC to ${TEST_ACCOUNTS.map((a) => a.label).join(' and ')}`)
}

console.log('\nTest chain ready. Reload the Preview.')
if (!anvil) process.exit(0)
const stop = () => anvil?.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
