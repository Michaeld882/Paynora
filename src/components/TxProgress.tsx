import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Hourglass, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { Button, Card, cx } from '@/components/ui'
import type { usePayment } from '@/hooks/usePayment'
import { ExplorerLink } from '@/components/ExplorerLink'

type Payment = ReturnType<typeof usePayment>
type Tone = 'work' | 'wait' | 'ok' | 'bad'

interface View {
  tone: Tone
  title: string
  body: string
}

function describe(p: Payment): View {
  switch (p.phase) {
    case 'preparing':
      return { tone: 'work', title: 'Checking your payment', body: 'Reading your balance and USDC approval from Arc.' }
    case 'switching':
      return { tone: 'wait', title: 'Switch network', body: 'Approve the network switch to Arc Mainnet in your wallet.' }
    case 'approve-wallet':
      return { tone: 'wait', title: 'Step 1 of 2: approve USDC', body: 'Confirm in your wallet. This approves only the exact amount of this payment.' }
    case 'approve-chain':
      return { tone: 'work', title: 'Waiting for approval', body: 'Your approval is being confirmed on Arc.' }
    case 'pay-wallet':
      return { tone: 'wait', title: 'Confirm the payment', body: 'Review and confirm the payment in your wallet.' }
    case 'rejected':
      return { tone: 'bad', title: 'Request rejected', body: p.error?.message ?? 'Nothing was sent.' }
    case 'error':
      return { tone: 'bad', title: 'Payment not sent', body: p.error?.message ?? 'Something went wrong.' }
    case 'submitted': {
      const status = p.entry?.status ?? 'pending'
      if (status === 'confirmed') return { tone: 'ok', title: 'Payment confirmed', body: 'The receipt and the Paynora payment event were both verified onchain.' }
      if (status === 'failed') return { tone: 'bad', title: 'Payment failed', body: p.entry?.detail ?? 'The transaction failed. No USDC moved.' }
      if (status === 'unverified') return { tone: 'bad', title: 'Could not verify payment', body: p.entry?.detail ?? 'Check the transaction on the explorer before trying again.' }
      if (status === 'dropped') return { tone: 'bad', title: 'Transaction not found', body: p.entry?.detail ?? 'The network has no record of this transaction.' }
      return { tone: 'work', title: 'Payment submitted', body: 'Waiting for confirmation on Arc. You can close this page: Paynora resumes tracking when you return.' }
    }
    default:
      return { tone: 'work', title: 'Working', body: '' }
  }
}

const ICON: Record<Tone, ReactNode> = {
  work: <Loader2 className="h-8 w-8 animate-spin" aria-hidden />,
  wait: <Hourglass className="h-8 w-8" aria-hidden />,
  ok: <CheckCircle2 className="h-8 w-8" aria-hidden />,
  bad: <XCircle className="h-8 w-8" aria-hidden />,
}

const TONE: Record<Tone, string> = {
  work: 'bg-sunk text-ink',
  wait: 'bg-warn/15 text-warn',
  ok: 'bg-ok/15 text-ok',
  bad: 'bg-bad/12 text-bad',
}

interface TxProgressProps {
  payment: Payment
  summary: ReactNode
  /** Success: leave the flow. */
  onDone: () => void
  /** Success: start a fresh payment. */
  onNew: () => void
  /** Failure: go back and edit. */
  onEdit: () => void
  /** Failure: run the same payment again. */
  onRetry: () => void
}

export function TxProgress({ payment, summary, onDone, onNew, onEdit, onRetry }: TxProgressProps) {
  const view = describe(payment)
  const status = payment.entry?.status
  const hash = payment.entry?.hash
  const finished = payment.phase === 'rejected' || payment.phase === 'error' || (payment.phase === 'submitted' && status !== 'pending' && status !== undefined)

  return (
    <Card>
      <div className="flex flex-col items-center py-4 text-center" role="status" aria-live="polite">
        <motion.div
          key={view.tone + view.title}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 24 }}
          className={cx('mb-5 flex h-20 w-20 items-center justify-center rounded-full', TONE[view.tone])}
        >
          {ICON[view.tone]}
        </motion.div>
        <h2 className="text-2xl font-bold">{view.title}</h2>
        <p className="mt-2 max-w-sm text-[15px] text-muted">{view.body}</p>
      </div>

      <div className="mt-2 rounded-2xl bg-sunk/70 p-4">{summary}</div>

      {(payment.approveHash || hash) && (
        <ul className="mt-4 space-y-2 text-sm">
          {payment.approveHash && (
            <li>
              <ExplorerLink hash={payment.approveHash} className="font-semibold underline-offset-2 hover:underline">
                Approval transaction
              </ExplorerLink>
            </li>
          )}
          {hash && (
            <li>
              <ExplorerLink hash={hash} className="font-semibold underline-offset-2 hover:underline">
                View payment on Arc Explorer
              </ExplorerLink>
            </li>
          )}
        </ul>
      )}

      {status === 'unverified' && (
        <p className="mt-4 flex items-start gap-2 text-[13px] text-bad">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Paynora will not call this a success until the matching payment event is found.
        </p>
      )}
      {payment.phase === 'approve-wallet' || payment.phase === 'pay-wallet' ? (
        <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Waiting for your wallet. If no prompt appeared, open your wallet extension.
        </p>
      ) : null}

      {finished && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {status === 'confirmed' ? (
            <>
              <Button variant="secondary" onClick={onNew}>
                New payment
              </Button>
              <Button onClick={onDone}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onEdit}>
                Edit payment
              </Button>
              <Button onClick={onRetry} disabled={status === 'dropped' || status === 'unverified'}>
                Try again
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
