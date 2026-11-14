/**
 * Real Paynora activity. Reads PaymentSent events for the connected account straight from
 * the Arc RPC, starting at the contract's deploy block (never block 0), and resolves any
 * locally journalled transactions against their receipts.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { getAbiItem, type Address, type Hex, type PublicClient } from 'viem'
import { paynoraAbi } from '@/paynoraAbi'
import { CHAIN_ID, PAYNORA_ADDRESS, PAYNORA_DEPLOY_BLOCK } from '@/paynora'
import { TEST_MODE } from '@/mode'
import { journal, useJournal, type LocalPayment } from '@/lib/pending'
import { resolveEntry } from '@/lib/verify'

export interface ChainPayment {
  key: string
  hash: Hex
  blockNumber: bigint
  from: Address
  to: Address
  amount: bigint
  requestId: Hex
  note: string
  timestamp: number
}

export type ScanStatus = 'disabled' | 'idle' | 'scanning' | 'ready' | 'error'

interface ActivityValue {
  payments: ChainPayment[]
  status: ScanStatus
  head?: bigint
  scannedTo?: bigint
  startBlock?: bigint
  error?: string
  refresh: () => void
}

const CHUNK = 5000n
const POLL_MS = 10_000
export const REFRESH_EVENT = 'paynora:refresh'

const ActivityContext = createContext<ActivityValue | undefined>(undefined)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const errText = (e: unknown) => `${(e as { name?: string }).name ?? ''} ${(e as { message?: string }).message ?? ''}`.toLowerCase()

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= 4 || !/rate limit|429|timeout|timed out|http request failed|fetch/.test(errText(e))) throw e
      await sleep(800 * 2 ** attempt)
    }
  }
}

const paymentEvent = getAbiItem({ abi: paynoraAbi, name: 'PaymentSent' })

const getSent = (client: PublicClient, account: Address, fromBlock: bigint, toBlock: bigint) =>
  client.getLogs({ address: PAYNORA_ADDRESS, event: paymentEvent, args: { from: account }, fromBlock, toBlock, strict: true })
const getReceived = (client: PublicClient, account: Address, fromBlock: bigint, toBlock: bigint) =>
  client.getLogs({ address: PAYNORA_ADDRESS, event: paymentEvent, args: { to: account }, fromBlock, toBlock, strict: true })

type PaymentLog = Awaited<ReturnType<typeof getSent>>[number]

async function fetchRange(client: PublicClient, account: Address, from: bigint, to: bigint): Promise<PaymentLog[]> {
  if (!PAYNORA_ADDRESS) return []
  try {
    const sent = await retry(() => getSent(client, account, from, to))
    const received = await retry(() => getReceived(client, account, from, to))
    return [...sent, ...received]
  } catch (e) {
    // The RPC caps the block range of a log query: split the range and try each half.
    if (to > from && !/rate limit|429/.test(errText(e)) && /range|too large|too many|exceed/.test(errText(e))) {
      const mid = from + (to - from) / 2n
      return [...(await fetchRange(client, account, from, mid)), ...(await fetchRange(client, account, mid + 1n, to))]
    }
    throw e
  }
}

interface Stored {
  scannedTo: string
  payments: (Omit<ChainPayment, 'blockNumber' | 'amount'> & { blockNumber: string; amount: string })[]
}

const storeKey = (account: Address) => `paynora:index:v1:${PAYNORA_ADDRESS}:${account.toLowerCase()}`

function load(account: Address): { scannedTo?: bigint; payments: ChainPayment[] } {
  if (TEST_MODE) return { payments: [] } // the local test chain is cheap to rescan and may be reset at any time
  try {
    const raw = localStorage.getItem(storeKey(account))
    if (!raw) return { payments: [] }
    const parsed = JSON.parse(raw) as Stored
    return {
      scannedTo: BigInt(parsed.scannedTo),
      payments: parsed.payments.map((p) => ({ ...p, blockNumber: BigInt(p.blockNumber), amount: BigInt(p.amount) })),
    }
  } catch {
    return { payments: [] }
  }
}

function save(account: Address, scannedTo: bigint, payments: ChainPayment[]) {
  if (TEST_MODE) return
  const stored: Stored = {
    scannedTo: scannedTo.toString(),
    payments: payments.map((p) => ({ ...p, blockNumber: p.blockNumber.toString(), amount: p.amount.toString() })),
  }
  try {
    localStorage.setItem(storeKey(account), JSON.stringify(stored))
  } catch {
    // Cache only: a failed write just means a rescan next visit.
  }
}

async function watchEntry(client: PublicClient, entry: LocalPayment) {
  let current = entry
  let replacedReason: string | undefined
  try {
    await client.waitForTransactionReceipt({
      hash: entry.hash,
      timeout: 60_000,
      onReplaced: (r) => {
        replacedReason = r.reason
        current = { ...entry, hash: r.transaction.hash }
      },
    })
  } catch {
    // Timeout or RPC hiccup: fall through and look the transaction up directly.
  }
  if (replacedReason && replacedReason !== 'repriced') {
    journal.update(entry.hash, { status: 'failed', detail: 'This transaction was replaced in your wallet, so this payment did not happen.' })
    return
  }
  if (current.hash !== entry.hash) {
    journal.remove(entry.hash)
    journal.add(current)
  }
  try {
    const result = await resolveEntry(client, current)
    if (result.status === 'pending') return
    journal.update(current.hash, result)
    if (result.status === 'confirmed') window.dispatchEvent(new Event(REFRESH_EVENT))
  } catch {
    // RPC unavailable: the entry stays pending and is retried on the next tick.
  }
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount()
  // Re-mount per account so every account starts from its own cached index.
  return (
    <Scanner key={address ?? 'none'} account={address}>
      {children}
    </Scanner>
  )
}

function Scanner({ account, children }: { account: Address | undefined; children: ReactNode }) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const entries = useJournal(account)
  const enabled = Boolean(client && account && PAYNORA_ADDRESS && PAYNORA_DEPLOY_BLOCK !== undefined)

  const [cached] = useState(() => (enabled && account ? load(account) : { scannedTo: undefined, payments: [] as ChainPayment[] }))
  const [payments, setPayments] = useState<ChainPayment[]>(() => [...cached.payments].sort((a, b) => Number(b.blockNumber - a.blockNumber)))
  const [status, setStatus] = useState<ScanStatus>(enabled ? 'idle' : 'disabled')
  const [head, setHead] = useState<bigint>()
  const [scannedTo, setScannedTo] = useState<bigint | undefined>(cached.scannedTo)
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)

  const scanned = useRef<bigint | undefined>(cached.scannedTo)
  const all = useRef<Map<string, ChainPayment>>(new Map(cached.payments.map((p) => [p.key, p])))
  const stamps = useRef<Map<bigint, number>>(new Map(cached.payments.map((p) => [p.blockNumber, p.timestamp])))
  const busy = useRef(false)
  const watching = useRef<Set<string>>(new Set())

  const sync = useCallback(async () => {
    if (!enabled || !client || !account || PAYNORA_DEPLOY_BLOCK === undefined || busy.current) return
    busy.current = true
    try {
      const latest = await retry(() => client.getBlockNumber())
      setHead(latest)
      let from = scanned.current !== undefined ? scanned.current + 1n : PAYNORA_DEPLOY_BLOCK
      if (from <= latest) setStatus('scanning')
      while (from <= latest) {
        const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n
        const logs = await fetchRange(client, account, from, to)
        for (const log of logs) {
          if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue
          let timestamp = stamps.current.get(log.blockNumber)
          if (timestamp === undefined) {
            const block = await retry(() => client.getBlock({ blockNumber: log.blockNumber }))
            timestamp = Number(block.timestamp)
            stamps.current.set(log.blockNumber, timestamp)
          }
          const key = `${log.transactionHash}:${log.logIndex}`
          all.current.set(key, {
            key,
            hash: log.transactionHash,
            blockNumber: log.blockNumber,
            from: log.args.from,
            to: log.args.to,
            amount: log.args.amount,
            requestId: log.args.requestId,
            note: log.args.note,
            timestamp,
          })
        }
        scanned.current = to
        const list = [...all.current.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber))
        setPayments(list)
        setScannedTo(to)
        save(account, to, list)
        from = to + 1n
      }
      setError(undefined)
      setStatus('ready')
    } catch {
      setError('Could not read payment activity from the Arc RPC. It will retry automatically.')
      setStatus('error')
    } finally {
      busy.current = false
    }
  }, [enabled, client, account])

  useEffect(() => {
    if (!enabled) return
    const first = setTimeout(() => void sync(), 0)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void sync()
    }, POLL_MS)
    const onRefresh = () => void sync()
    window.addEventListener(REFRESH_EVENT, onRefresh)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener(REFRESH_EVENT, onRefresh)
    }
  }, [enabled, sync])

  // Resolve in-flight journal entries against real receipts (also recovers after a reload).
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!client) return
    for (const entry of entries) {
      if (entry.status !== 'pending' || watching.current.has(entry.id)) continue
      watching.current.add(entry.id)
      void watchEntry(client, entry).finally(() => watching.current.delete(entry.id))
    }
  }, [entries, client, tick])

  const refresh = useCallback(() => {
    window.dispatchEvent(new Event(REFRESH_EVENT))
  }, [])

  const value = useMemo<ActivityValue>(
    () => ({ payments, status, head, scannedTo, startBlock: PAYNORA_DEPLOY_BLOCK, error, refresh }),
    [payments, status, head, scannedTo, error, refresh],
  )
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
}

export function useActivity(): ActivityValue {
  const value = useContext(ActivityContext)
  if (!value) throw new Error('useActivity must be used inside ActivityProvider')
  return value
}

export interface FeedItem {
  key: string
  hash: Hex
  direction: 'sent' | 'received'
  counterparty: Address
  amount: bigint
  note: string
  requestId: Hex
  timestamp: number
  status: 'confirmed' | 'pending' | 'failed' | 'unverified' | 'dropped'
  source: 'chain' | 'local'
  detail?: string
}

/** Chain events plus this browser's own in-flight transactions, newest first. */
export function useFeed(account: Address | undefined): FeedItem[] {
  const { payments } = useActivity()
  const entries = useJournal(account)
  return useMemo(() => {
    if (!account) return []
    const me = account.toLowerCase()
    const onchain: FeedItem[] = payments.map((p) => ({
      key: p.key,
      hash: p.hash,
      direction: p.from.toLowerCase() === me ? 'sent' : 'received',
      counterparty: p.from.toLowerCase() === me ? p.to : p.from,
      amount: p.amount,
      note: p.note,
      requestId: p.requestId,
      timestamp: p.timestamp,
      status: 'confirmed',
      source: 'chain',
    }))
    const seen = new Set(payments.map((p) => p.hash.toLowerCase()))
    const local: FeedItem[] = entries
      .filter((e) => !seen.has(e.hash.toLowerCase()))
      .map((e) => ({
        key: `local:${e.id}`,
        hash: e.hash,
        direction: 'sent',
        counterparty: e.to,
        amount: BigInt(e.amount),
        note: e.note,
        requestId: e.requestId,
        timestamp: e.createdAt,
        status: e.status,
        source: 'local',
        detail: e.detail,
      }))
    return [...local, ...onchain].sort((a, b) => b.timestamp - a.timestamp)
  }, [payments, entries, account])
}
