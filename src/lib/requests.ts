/**
 * Payment-request helpers: EIP-712 typed data, share-link encoding and the local list of
 * requests this browser created. A request link is an authorisation signed by the payee; it
 * proves nothing about payment. Only a verified PaymentSent event does.
 */
import { useSyncExternalStore } from 'react'
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem'
import { CHAIN_ID, MAX_NOTE_BYTES } from '@/paynora'
import { buildShareLink } from '@/lib/share'
import { byteLength } from '@/lib/format'

export const requestTypes = {
  PaymentRequest: [
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'requestId', type: 'bytes32' },
    { name: 'note', type: 'string' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const

export const requestDomain = (verifyingContract: Address) =>
  ({ name: 'Paynora', version: '1', chainId: CHAIN_ID, verifyingContract }) as const

export interface PaymentRequestData {
  payee: Address
  amount: bigint
  requestId: Hex
  note: string
  expiry: bigint
}

export interface SignedRequest extends PaymentRequestData {
  signature: Hex
}

export function newRequestId(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Path + query for a request. Contains the payee signature, which authorises payment but is not a secret. */
export function requestPath(r: SignedRequest): string {
  const q = new URLSearchParams({
    to: r.payee,
    amt: r.amount.toString(),
    id: r.requestId,
    exp: r.expiry.toString(),
    v: r.signature,
  })
  if (r.note) q.set('memo', r.note)
  return `/r?${q.toString()}`
}

export const requestLink = (r: SignedRequest) => buildShareLink(requestPath(r))

export type ParsedRequest = { ok: true; request: SignedRequest } | { ok: false; reason: string }

export function parseRequest(search: URLSearchParams): ParsedRequest {
  const to = search.get('to') ?? ''
  const amt = search.get('amt') ?? ''
  const id = search.get('id') ?? ''
  const exp = search.get('exp') ?? ''
  const v = search.get('v') ?? ''
  const note = search.get('memo') ?? ''
  if (!to && !amt && !id && !v) return { ok: false, reason: 'This link has no payment request in it.' }
  if (!isAddress(to, { strict: false })) return { ok: false, reason: 'The payee address in this link is not valid.' }
  if (!/^\d+$/.test(amt) || BigInt(amt) === 0n || BigInt(amt) >= 2n ** 128n) {
    return { ok: false, reason: 'The amount in this link is not valid.' }
  }
  if (!isHex(id, { strict: true }) || id.length !== 66 || /^0x0+$/.test(id)) {
    return { ok: false, reason: 'The request reference in this link is not valid.' }
  }
  if (!/^\d{1,12}$/.test(exp)) return { ok: false, reason: 'The expiry in this link is not valid.' }
  if (!isHex(v, { strict: true }) || v.length < 132) return { ok: false, reason: 'This link is missing the payee signature.' }
  if (byteLength(note) > MAX_NOTE_BYTES) return { ok: false, reason: 'The note in this link is too long.' }
  return {
    ok: true,
    request: {
      payee: getAddress(to),
      amount: BigInt(amt),
      requestId: id,
      note,
      expiry: BigInt(exp),
      signature: v,
    },
  }
}

/* ---- Requests created in this browser (convenience list; status always comes from the chain) ---- */

export interface StoredRequest {
  payee: Address
  amount: string
  requestId: Hex
  note: string
  expiry: string
  signature: Hex
  createdAt: number
}

const KEY = 'paynora:requests:v1'
const listeners = new Set<() => void>()
let cache: StoredRequest[] | undefined

function read(): StoredRequest[] {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    cache = Array.isArray(parsed) ? (parsed as StoredRequest[]) : []
  } catch {
    cache = []
  }
  return cache
}

export function saveRequest(r: SignedRequest) {
  const entry: StoredRequest = {
    payee: r.payee,
    amount: r.amount.toString(),
    requestId: r.requestId,
    note: r.note,
    expiry: r.expiry.toString(),
    signature: r.signature,
    createdAt: Math.floor(Date.now() / 1000),
  }
  cache = [entry, ...read().filter((e) => e.requestId !== r.requestId)].slice(0, 50)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Non-fatal: the list is a convenience only.
  }
  listeners.forEach((l) => l())
}

export function toSigned(s: StoredRequest): SignedRequest {
  return { payee: s.payee, amount: BigInt(s.amount), requestId: s.requestId, note: s.note, expiry: BigInt(s.expiry), signature: s.signature }
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useStoredRequests(payee: Address | undefined): StoredRequest[] {
  const all = useSyncExternalStore(subscribe, read, read)
  if (!payee) return []
  return all.filter((e) => e.payee.toLowerCase() === payee.toLowerCase())
}
