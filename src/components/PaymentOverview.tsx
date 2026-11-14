import { ArrowRight, CheckCircle2, Clock, History, ListChecks, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { FeedList } from '@/components/FeedList'
import { Card, EmptyState, Skeleton, cx } from '@/components/ui'
import { useActivity, useFeed } from '@/hooks/ActivityProvider'
import { fmtUsdc } from '@/lib/format'
import { Link, pathFor } from '@/lib/router'
import { NETWORK_NAME, configProblem } from '@/paynora'
import type { Address } from 'viem'

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-2xl bg-sunk/70 p-3.5">
      <div className={cx('mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-card', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{icon}</div>
      <p className="num font-display text-2xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted">{label}</p>
    </div>
  )
}

/** Payment counts and volume for the connected wallet, derived only from Arc events and this wallet's own receipts. */
export function PaymentOverview({ address }: { address: Address }) {
  const feed = useFeed(address)
  const { status, scannedTo, head, startBlock, error } = useActivity()
  const unavailable = Boolean(configProblem)
  const loading = !unavailable && feed.length === 0 && (status === 'scanning' || status === 'idle')

  const confirmed = feed.filter((i) => i.status === 'confirmed')
  const pending = feed.filter((i) => i.status === 'pending').length
  const problems = feed.filter((i) => i.status === 'failed' || i.status === 'unverified' || i.status === 'dropped').length
  const sentTotal = confirmed.filter((i) => i.direction === 'sent').reduce((sum, i) => sum + i.amount, 0n)
  const receivedTotal = confirmed.filter((i) => i.direction === 'received').reduce((sum, i) => sum + i.amount, 0n)
  const remaining = head !== undefined && scannedTo !== undefined && head > scannedTo ? head - scannedTo : undefined
  const dash = (n: number) => (unavailable ? '—' : n.toLocaleString())

  return (
    <Card aria-labelledby="overview-title">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="overview-title" className="text-lg font-semibold">
          Payment Overview
        </h2>
        <Link to={pathFor('activity')} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          See all <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3" aria-busy>
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-[92px] w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={<ListChecks className="h-4 w-4" aria-hidden />} label="Total payments" value={dash(feed.length)} />
          <Stat icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} label="Successful" value={dash(confirmed.length)} tone="ok" />
          <Stat icon={<Clock className="h-4 w-4" aria-hidden />} label="Pending" value={dash(pending)} tone="warn" />
          <Stat icon={<TriangleAlert className="h-4 w-4" aria-hidden />} label="Failed or unverified" value={dash(problems)} tone={problems > 0 ? 'bad' : undefined} />
        </div>
      )}

      {!unavailable && !loading && (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border border-line/70 px-3.5 py-3">
            <dt className="text-xs text-muted">Sent</dt>
            <dd className="num font-semibold">{fmtUsdc(sentTotal)} USDC</dd>
          </div>
          <div className="rounded-2xl border border-line/70 px-3.5 py-3">
            <dt className="text-xs text-muted">Received</dt>
            <dd className="num font-semibold">{fmtUsdc(receivedTotal)} USDC</dd>
          </div>
        </dl>
      )}

      <p className="mt-3 text-xs text-muted" role="status">
        {unavailable
          ? 'Counts appear once the Paynora contract is configured. Nothing is estimated.'
          : status === 'error'
            ? (error ?? 'Could not reach Arc.')
            : status === 'scanning' || status === 'idle'
              ? `Reading ${NETWORK_NAME} from block ${startBlock?.toLocaleString()}${remaining !== undefined ? ` · ${remaining.toLocaleString()} blocks to go` : ''}. Counts update as it goes.`
              : `Live from ${NETWORK_NAME}${scannedTo !== undefined ? ` · up to block ${scannedTo.toLocaleString()}` : ''}.`}
      </p>

      {!unavailable && (
        <div className="mt-4 border-t border-line/70 pt-2">
          <h3 className="pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Recent activity</h3>
          {feed.length > 0 ? (
            <FeedList items={feed.slice(0, 4)} />
          ) : loading ? (
            <Skeleton className="my-2 h-14 w-full" />
          ) : (
            <EmptyState icon={<History className="h-6 w-6" aria-hidden />} title="No payments yet">
              Payments you send or receive through Paynora will show up here.
            </EmptyState>
          )}
        </div>
      )}
    </Card>
  )
}
