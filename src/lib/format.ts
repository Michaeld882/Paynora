import { Amount } from '@/onchain-money'
import { USDC_DECIMALS } from '@/paynora'

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

export const shortHash = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`

const group = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Formats a raw 6-decimal USDC amount: at least two decimals, never rounds money up. */
export function fmtUsdc(raw: bigint): string {
  const exact = Amount.fromRaw(raw < 0n ? -raw : raw, USDC_DECIMALS).toString()
  const [whole, fraction = ''] = exact.split('.')
  const padded = fraction.padEnd(2, '0')
  return `${raw < 0n ? '-' : ''}${group(whole)}.${padded}`
}

export function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(unixSeconds: number, now = Date.now()): string {
  const diff = Math.max(0, Math.floor(now / 1000 - unixSeconds))
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return fmtDate(unixSeconds)
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
