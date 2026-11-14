import { ArrowDownLeft, ArrowUpRight, Loader2, X } from 'lucide-react'
import { Pill, cx } from '@/components/ui'
import type { FeedItem } from '@/hooks/ActivityProvider'
import { journal } from '@/lib/pending'
import { fmtDate, fmtUsdc, shortAddress, timeAgo } from '@/lib/format'
import { ExplorerLink } from '@/components/ExplorerLink'

const STATUS: Record<FeedItem['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  confirmed: { label: 'Confirmed', tone: 'ok' },
  pending: { label: 'Pending', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
  unverified: { label: 'Not verified', tone: 'bad' },
  dropped: { label: 'Not found', tone: 'bad' },
}

export function StatusPill({ status }: { status: FeedItem['status'] }) {
  const { label, tone } = STATUS[status]
  return (
    <Pill tone={tone}>
      {status === 'pending' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {label}
    </Pill>
  )
}

export function FeedRow({ item }: { item: FeedItem }) {
  const sent = item.direction === 'sent'
  const settled = item.status === 'confirmed'
  const dismissable = item.source === 'local' && (item.status === 'failed' || item.status === 'unverified' || item.status === 'dropped')
  return (
    <li className="flex items-start gap-3 py-3.5">
      <div className={cx('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', sent ? 'bg-sunk text-ink' : 'bg-ok/12 text-ok')}>
        {sent ? <ArrowUpRight className="h-5 w-5" aria-hidden /> : <ArrowDownLeft className="h-5 w-5" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[15px] font-semibold">
            {sent ? 'To ' : 'From '}
            <span className="num font-mono text-[13px] font-medium" title={item.counterparty}>
              {shortAddress(item.counterparty)}
            </span>
          </p>
          <p className={cx('num shrink-0 text-[15px] font-semibold', settled ? (sent ? 'text-ink' : 'text-ok') : 'text-muted')}>
            {sent ? '−' : '+'}
            {fmtUsdc(item.amount)}
          </p>
        </div>
        {item.note && <p className="mt-0.5 truncate text-[13px] text-muted">{item.note}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
          <StatusPill status={item.status} />
          <span title={fmtDate(item.timestamp)}>{timeAgo(item.timestamp)}</span>
          {item.requestId !== `0x${'0'.repeat(64)}` && <span>Request</span>}
          <ExplorerLink hash={item.hash} className="font-medium text-ink underline-offset-2 hover:underline">
            Explorer
          </ExplorerLink>
          {dismissable && (
            <button onClick={() => journal.remove(item.hash)} className="inline-flex items-center gap-1 font-medium hover:text-ink" aria-label="Dismiss this entry">
              <X className="h-3 w-3" aria-hidden /> Dismiss
            </button>
          )}
        </div>
        {item.detail && <p className="mt-1.5 text-xs text-bad">{item.detail}</p>}
      </div>
    </li>
  )
}

export function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <ul className="divide-y divide-line/70">
      {items.map((item) => (
        <FeedRow key={item.key} item={item} />
      ))}
    </ul>
  )
}
