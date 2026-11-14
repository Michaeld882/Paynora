/**
 * Receipt verification. A payment is only "confirmed" when its receipt succeeded AND the
 * Paynora contract emitted a PaymentSent event that matches what the payer intended to send.
 */
import { parseEventLogs, type PublicClient, type TransactionReceipt } from 'viem'
import { paynoraAbi } from '@/paynoraAbi'
import { PAYNORA_ADDRESS } from '@/paynora'
import type { LocalPayment, LocalStatus } from '@/lib/pending'

export interface Resolution {
  status: LocalStatus
  detail?: string
}

const DROPPED_AFTER_SECONDS = 10 * 60

export function verifyReceipt(receipt: TransactionReceipt, entry: LocalPayment): Resolution {
  if (receipt.status !== 'success') {
    return { status: 'failed', detail: 'The transaction was mined but reverted. No USDC moved.' }
  }
  const paynora = PAYNORA_ADDRESS
  if (!paynora) return { status: 'unverified', detail: 'The Paynora contract is not configured.' }
  // The event is the proof: only the Paynora contract can emit PaymentSent, so receipt.to is not
  // required to be the contract (smart-contract wallets may route the call through another address).
  const events = parseEventLogs({ abi: paynoraAbi, logs: receipt.logs, eventName: 'PaymentSent' })
  const match = events.find(
    (e) =>
      e.address.toLowerCase() === paynora.toLowerCase() &&
      e.args.from.toLowerCase() === entry.from.toLowerCase() &&
      e.args.to.toLowerCase() === entry.to.toLowerCase() &&
      e.args.amount === BigInt(entry.amount) &&
      e.args.requestId.toLowerCase() === entry.requestId.toLowerCase() &&
      e.args.note === entry.note,
  )
  return match
    ? { status: 'confirmed' }
    : { status: 'unverified', detail: 'The receipt succeeded but no matching Paynora payment event was found.' }
}

/** Looks the transaction up on chain and decides what it is, without ever guessing success. */
export async function resolveEntry(client: PublicClient, entry: LocalPayment): Promise<Resolution> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: entry.hash })
    return verifyReceipt(receipt, entry)
  } catch (error) {
    const name = (error as { name?: string }).name ?? ''
    if (name !== 'TransactionReceiptNotFoundError') throw error
  }
  try {
    await client.getTransaction({ hash: entry.hash })
    return { status: 'pending' }
  } catch (error) {
    const name = (error as { name?: string }).name ?? ''
    if (name !== 'TransactionNotFoundError') throw error
  }
  const age = Math.floor(Date.now() / 1000) - entry.createdAt
  return age > DROPPED_AFTER_SECONDS
    ? { status: 'dropped', detail: 'The network has no record of this transaction. It was probably dropped or replaced.' }
    : { status: 'pending' }
}
