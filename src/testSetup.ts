/**
 * Test Mode start-up. The local test chain is rebuilt from scratch whenever it restarts, so any
 * browser-side leftovers (payment journal, request list, cached activity) from an earlier chain
 * would show payments that never happened on this one. Detect a new chain by its genesis hash and
 * clear those leftovers before the app renders.
 */
import { TEST_RPC_PATH } from './testChain'

const EPOCH_KEY = 'paynora:test-epoch'
const KEEP = new Set([EPOCH_KEY, 'paynora:theme', 'paynora:test-account'])

async function genesisHash(): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const response = await fetch(`${window.location.origin}${TEST_RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['0x0', false] }),
      signal: controller.signal,
    })
    const json = (await response.json()) as { result?: { hash?: string } }
    return json.result?.hash
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export async function prepareTestMode(): Promise<void> {
  const hash = await genesisHash()
  if (!hash) return // chain offline: the app shows its own "test chain offline" state
  if (localStorage.getItem(EPOCH_KEY) === hash) return
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('paynora:') && !KEEP.has(key)) localStorage.removeItem(key)
  }
  localStorage.setItem(EPOCH_KEY, hash)
}
