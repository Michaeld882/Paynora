/**
 * In-app "Preview test wallet" for Test Mode: an EIP-1193 provider that signs through the local
 * test node's unlocked development accounts. No private keys are handled in the browser.
 */
import type { Address } from 'viem'
import { TEST_ACCOUNTS, TEST_RPC_PATH } from './testChain'

type Listener = (value: unknown) => void

const STORAGE_KEY = 'paynora:test-account'
const listeners = new Map<string, Set<Listener>>()

export function activeTestAccountIndex(): 0 | 1 {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1' ? 1 : 0
  } catch {
    return 0
  }
}

const activeAddress = (): Address => TEST_ACCOUNTS[activeTestAccountIndex()].address

export function setActiveTestAccount(index: 0 | 1) {
  try {
    localStorage.setItem(STORAGE_KEY, String(index))
  } catch {
    // The choice still applies for this session through the event below.
  }
  listeners.get('accountsChanged')?.forEach((fn) => fn([activeAddress()]))
}

async function forward(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(`${window.location.origin}${TEST_RPC_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
  const json = (await response.json()) as { result?: unknown; error?: { message: string; code: number } }
  if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code })
  return json.result
}

export const testProvider = {
  request: async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [activeAddress()]
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        return null
      case 'eth_sendTransaction':
        return forward(method, [{ ...(params[0] as object), from: activeAddress() }])
      case 'eth_signTypedData_v4':
        return forward(method, [activeAddress(), params[1]])
      default:
        return forward(method, params)
    }
  },
  on: (event: string, listener: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>()
    set.add(listener)
    listeners.set(event, set)
  },
  removeListener: (event: string, listener: Listener) => {
    listeners.get(event)?.delete(listener)
  },
}
