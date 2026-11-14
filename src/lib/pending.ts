/**
 * Local transaction journal. This is UI state, not chain data: it remembers payments this
 * browser submitted so they can be resumed after a reload. Every entry is resolved against
 * the real receipt and removed once the PaymentSent event is indexed.
 */
import { useSyncExternalStore } from 'react'
import type { Address, Hex } from 'viem'

export type LocalStatus = 'pending' | 'confirmed' | 'failed' | 'unverified' | 'dropped'

export interface LocalPayment {
  /** Stable id: survives a speed-up that changes the transaction hash. */
  id: string
  hash: Hex
  from: Address
  to: Address
  amount: string // raw 6-decimal USDC base units
  requestId: Hex
  note: string
  createdAt: number // unix seconds
  status: LocalStatus
  detail?: string
}

const KEY = 'paynora:journal:v1'
const listeners = new Set<() => void>()
let cache: LocalPayment[] | undefined

function read(): LocalPayment[] {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    cache = Array.isArray(parsed) ? (parsed as LocalPayment[]) : []
  } catch {
    cache = []
  }
  return cache
}

function write(next: LocalPayment[]) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage may be unavailable (private mode); the in-memory copy still works for this session.
  }
  listeners.forEach((l) => l())
}

export const journal = {
  add(entry: LocalPayment) {
    const dayAgo = Math.floor(Date.now() / 1000) - 86_400
    // Verified entries are kept for a day so a status screen never loses them, then pruned.
    const kept = read().filter((e) => e.hash !== entry.hash && !(e.status === 'confirmed' && e.createdAt < dayAgo))
    write([entry, ...kept])
  },
  update(hash: Hex, patch: Partial<LocalPayment>) {
    write(read().map((e) => (e.hash === hash ? { ...e, ...patch } : e)))
  },
  remove(hash: Hex) {
    write(read().filter((e) => e.hash !== hash))
  },
  all: read,
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cache = undefined
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useJournal(account: Address | undefined): LocalPayment[] {
  const all = useSyncExternalStore(subscribe, read, read)
  if (!account) return []
  return all.filter((e) => e.from.toLowerCase() === account.toLowerCase())
}
