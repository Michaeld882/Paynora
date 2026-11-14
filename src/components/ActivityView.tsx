import { useMemo, useState } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { ConfigCard, ConnectCard, SwitchCard } from '@/components/Gate'
import { FeedList } from '@/components/FeedList'
import { Button, Card, EmptyState, Notice, PageTitle, Skeleton, cx } from '@/components/ui'
import { useActivity, useFeed } from '@/hooks/ActivityProvider'
import { useWallet } from '@/hooks/useWallet'
import { configProblem } from '@/paynora'

type Filter = 'all' | 'sent' | 'received'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'received', label: 'Received' },
]

export function ActivityView() {
  const { address, isConnected, isConnecting, wrongNetwork } = useWallet()
  const feed = useFeed(address)
  const { status, head, scannedTo, startBlock, error, refresh } = useActivity()
  const [filter, setFilter] = useState<Filter>('all')
  const items = useMemo(() => (filter === 'all' ? feed : feed.filter((i) => i.direction === filter)), [feed, filter])
  const remaining = head !== undefined && scannedTo !== undefined && head > scannedTo ? head - scannedTo : undefined

  let body
  if (isConnecting) body = <Skeleton className="h-64 w-full rounded-3xl" />
  else if (!isConnected) body = <ConnectCard message="Connect a wallet to see your Paynora payments." />
  else if (wrongNetwork) body = <SwitchCard />
  else if (configProblem) body = <ConfigCard />
  else
    body = (
      <Card>
        <div role="tablist" aria-label="Filter payments" className="mb-2 grid grid-cols-3 gap-1 rounded-2xl bg-sunk p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cx('min-h-10 rounded-xl text-sm font-semibold transition', filter === f.id ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')}
            >
              {f.label}
            </button>
          ))}
        </div>
        {status === 'error' && (
          <div className="my-3">
            <Notice tone="bad" title="Activity is out of date" action={<Button variant="secondary" onClick={refresh}>Retry</Button>}>
              {error}
            </Notice>
          </div>
        )}
        {items.length > 0 ? (
          <FeedList items={items} />
        ) : status === 'scanning' || status === 'idle' ? (
          <div className="space-y-3 py-4" aria-busy>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <EmptyState icon={<History className="h-6 w-6" aria-hidden />} title={filter === 'all' ? 'No payments yet' : `No ${filter} payments`}>
            {filter === 'all' ? 'Payments you send or receive through Paynora will appear here once they are confirmed onchain.' : 'Nothing here yet.'}
          </EmptyState>
        )}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line/70 pt-3 text-xs text-muted">
          <span className="num">
            {status === 'scanning' || status === 'idle'
              ? `Scanning from block ${startBlock?.toLocaleString()}${remaining !== undefined ? ` · ${remaining.toLocaleString()} blocks to go` : ''}`
              : status === 'ready'
                ? `Up to date · block ${scannedTo?.toLocaleString()}`
                : ''}
          </span>
          <button onClick={refresh} className="inline-flex min-h-11 items-center gap-1.5 font-semibold hover:text-ink" aria-label="Refresh activity">
            <RefreshCw className={cx('h-3.5 w-3.5', (status === 'scanning') && 'animate-spin')} aria-hidden /> Refresh
          </button>
        </div>
      </Card>
    )

  return (
    <>
      <PageTitle title="Activity" subtitle="Real Paynora payments, read from Arc." />
      {body}
    </>
  )
}
