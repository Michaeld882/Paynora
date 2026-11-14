import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from 'wagmi'
import { CheckCircle2, HandCoins, Share2 } from 'lucide-react'
import { AmountField } from '@/components/AmountField'
import { Gate } from '@/components/Gate'
import { StatusPill } from '@/components/FeedList'
import { Button, Card, CopyButton, EmptyState, FieldError, Label, PageTitle, Pill, cx, inputClass } from '@/components/ui'
import { useActivity } from '@/hooks/ActivityProvider'
import { useNow } from '@/hooks/useNow'
import { useWallet } from '@/hooks/useWallet'
import { classifyError } from '@/lib/errors'
import { byteLength, fmtDate, fmtUsdc } from '@/lib/format'
import {
  newRequestId,
  requestDomain,
  requestLink,
  requestTypes,
  saveRequest,
  toSigned,
  useStoredRequests,
  type SignedRequest,
  type StoredRequest,
} from '@/lib/requests'
import { paynoraAbi } from '@/paynoraAbi'
import { parseAmount } from '@/onchain-money'
import { CHAIN_ID, MAX_NOTE_BYTES, PAYNORA_ADDRESS } from '@/paynora'
import { ExplorerLink } from '@/components/ExplorerLink'

const EXPIRIES = [
  { label: '24 hours', seconds: 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
] as const

/** Share link, resolved once the request exists. Copy, share and QR wait for it. */
function useLink(request: SignedRequest | undefined) {
  const [resolved, setResolved] = useState<{ request: SignedRequest; url: string }>()
  useEffect(() => {
    if (!request) return
    let alive = true
    void requestLink(request).then((url) => {
      if (alive) setResolved({ request, url })
    })
    return () => {
      alive = false
    }
  }, [request])
  return resolved && resolved.request === request ? resolved.url : undefined
}

function ShareCard({ request, onDone }: { request: SignedRequest; onDone: () => void }) {
  const link = useLink(request)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share = async () => {
    if (!link) return
    try {
      await navigator.share({ title: 'Paynora payment request', text: `Pay ${fmtUsdc(request.amount)} USDC`, url: link })
    } catch {
      // Cancelled or unsupported: copying remains available.
    }
  }
  return (
    <Card>
      <div className="flex flex-col items-center text-center">
        <Pill tone="warn" className="mb-3">
          Not paid yet
        </Pill>
        <h2 className="num text-3xl font-bold">{fmtUsdc(request.amount)} USDC</h2>
        {request.note && <p className="mt-1 text-[15px] text-muted">{request.note}</p>}
        <div className="mt-5 rounded-3xl bg-white p-4 shadow-sm">
          {link ? <QRCodeSVG value={link} size={196} level="M" fgColor="#0E1A2B" bgColor="#FFFFFF" /> : <div className="shimmer h-[196px] w-[196px] rounded-xl" aria-hidden />}
        </div>
        <p className="mt-4 max-w-sm text-[13px] text-muted">
          This link only asks for payment. Paynora shows it as paid only after the payment is verified onchain. Valid until {fmtDate(Number(request.expiry))}.
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <CopyButton value={link ?? ''} label="Copy link" disabled={!link} className="w-full" />
        {canShare ? (
          <Button onClick={() => void share()} disabled={!link}>
            <Share2 className="h-4 w-4" aria-hidden /> Share
          </Button>
        ) : (
          <Button onClick={onDone}>Done</Button>
        )}
      </div>
      {canShare && (
        <Button variant="ghost" block className="mt-2" onClick={onDone}>
          Done
        </Button>
      )}
    </Card>
  )
}

function CreateForm({ onCreated }: { onCreated: (r: SignedRequest) => void }) {
  const { address } = useWallet()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { signTypedDataAsync } = useSignTypedData()
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [expiry, setExpiry] = useState<number>(EXPIRIES[1].seconds)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string>()

  const amountError = useMemo(() => {
    if (!amountText || amountText === '.') return 'Enter an amount.'
    if (Number(amountText) === 0) return 'Amount must be greater than zero.'
    try {
      const parsed = parseAmount(CHAIN_ID, amountText)
      if (parsed.isZero()) return 'Amount must be greater than zero.'
      return parsed.raw >= 2n ** 100n ? 'That amount is too large.' : undefined
    } catch {
      return 'Use at most 6 decimal places.'
    }
  }, [amountText])
  const noteError = byteLength(note) > MAX_NOTE_BYTES ? `Notes are limited to ${MAX_NOTE_BYTES} bytes.` : undefined

  const submit = async () => {
    setTouched(true)
    if (amountError || noteError || !address || !PAYNORA_ADDRESS || !client || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const request = {
        payee: address,
        amount: parseAmount(CHAIN_ID, amountText).raw,
        requestId: newRequestId(),
        note: note.trim(),
        expiry: BigInt(Math.floor(Date.now() / 1000) + expiry),
      }
      const signature = await signTypedDataAsync({
        domain: requestDomain(PAYNORA_ADDRESS),
        types: requestTypes,
        primaryType: 'PaymentRequest',
        message: request,
      })
      const valid = await client.verifyTypedData({
        address,
        domain: requestDomain(PAYNORA_ADDRESS),
        types: requestTypes,
        primaryType: 'PaymentRequest',
        message: request,
        signature,
      })
      if (!valid) throw new Error('Signature did not verify')
      const signed = { ...request, signature }
      saveRequest(signed)
      onCreated(signed)
    } catch (e) {
      const known = classifyError(e)
      setError(known.kind === 'unknown' ? 'Could not create the request. Nothing was sent and no gas was spent.' : known.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Card className="space-y-5">
        <AmountField value={amountText} onChange={setAmountText} disabled={busy} error={touched ? amountError : undefined} hint="The exact amount your payer will be asked to send." />
        <div>
          <Label htmlFor="req-note">Note (optional, public once paid)</Label>
          <input id="req-note" className={inputClass} placeholder="Invoice #42" maxLength={200} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
          {noteError && <FieldError>{noteError}</FieldError>}
        </div>
        <fieldset>
          <legend className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Valid for</legend>
          <div className="grid grid-cols-3 gap-2">
            {EXPIRIES.map((o) => (
              <button
                key={o.seconds}
                type="button"
                onClick={() => setExpiry(o.seconds)}
                aria-pressed={expiry === o.seconds}
                className={cx('min-h-11 rounded-xl border text-sm font-semibold transition', expiry === o.seconds ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-sunk/70 hover:bg-sunk')}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" block loading={busy}>
          {busy ? 'Confirm in your wallet…' : 'Create request'}
        </Button>
        <p className="text-center text-xs text-muted">Signing is free: it only authorises this exact request. No transaction is sent.</p>
      </Card>
    </form>
  )
}

type RequestState = 'checking' | 'open' | 'expired' | 'paid' | 'cancelled'

function RequestRow({ stored }: { stored: StoredRequest }) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { payments, status: scan } = useActivity()
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const request = useMemo(() => toSigned(stored), [stored])
  const link = useLink(request)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string>()

  const open = useQuery({
    queryKey: ['request-open', stored.payee, stored.requestId],
    enabled: Boolean(client && PAYNORA_ADDRESS),
    refetchInterval: 15_000,
    queryFn: () => {
      if (!client || !PAYNORA_ADDRESS) throw new Error('not ready')
      return client.readContract({ address: PAYNORA_ADDRESS, abi: paynoraAbi, functionName: 'isRequestOpen', args: [stored.payee, stored.requestId] })
    },
  })
  const payment = payments.find((p) => p.requestId.toLowerCase() === stored.requestId.toLowerCase() && p.to.toLowerCase() === stored.payee.toLowerCase())
  const now = useNow()
  const expired = Number(stored.expiry) * 1000 < now
  const state: RequestState = payment
    ? 'paid'
    : open.data === undefined
      ? 'checking'
      : open.data === false
        ? scan === 'ready'
          ? 'cancelled'
          : 'checking'
        : expired
          ? 'expired'
          : 'open'

  const cancel = async () => {
    if (!client || !PAYNORA_ADDRESS || !address || cancelling) return
    setCancelling(true)
    setCancelError(undefined)
    try {
      const hash = await writeContractAsync({ address: PAYNORA_ADDRESS, abi: paynoraAbi, functionName: 'cancelRequest', args: [stored.requestId], chainId: CHAIN_ID })
      const receipt = await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Cancellation reverted')
      await queryClient.invalidateQueries({ queryKey: ['request-open'] })
    } catch (e) {
      setCancelError(classifyError(e).message)
    } finally {
      setCancelling(false)
    }
  }

  const tone = state === 'paid' ? 'ok' : state === 'open' ? 'warn' : 'muted'
  const label = { checking: 'Checking…', open: 'Open, unpaid', expired: 'Expired', paid: 'Paid', cancelled: 'Cancelled' }[state]

  return (
    <li className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-[15px] font-semibold">{fmtUsdc(BigInt(stored.amount))} USDC</p>
          {stored.note && <p className="truncate text-[13px] text-muted">{stored.note}</p>}
          <p className="mt-0.5 text-xs text-muted">Created {fmtDate(stored.createdAt)}</p>
        </div>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === 'open' && (
          <>
            <CopyButton value={link ?? ''} label="Copy link" disabled={!link} className="min-h-11" />
            <Button variant="danger" className="min-h-11" loading={cancelling} onClick={() => void cancel()}>
              Cancel request
            </Button>
          </>
        )}
        {state === 'paid' && payment && (
          <>
            <StatusPill status="confirmed" />
            <ExplorerLink hash={payment.hash} className="text-sm font-semibold underline-offset-2 hover:underline">
              Explorer
            </ExplorerLink>
          </>
        )}
      </div>
      {state === 'open' && <p className="mt-2 text-xs text-muted">Cancelling is a transaction and costs a small USDC network fee.</p>}
      {cancelError && <FieldError>{cancelError}</FieldError>}
    </li>
  )
}

function RequestFlow() {
  const { address } = useWallet()
  const stored = useStoredRequests(address)
  const [created, setCreated] = useState<SignedRequest>()
  return (
    <div className="space-y-4">
      {created ? <ShareCard request={created} onDone={() => setCreated(undefined)} /> : <CreateForm onCreated={setCreated} />}
      {!created && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Your requests</h2>
          {stored.length === 0 ? (
            <EmptyState icon={<HandCoins className="h-6 w-6" aria-hidden />} title="No requests yet">
              Requests you create on this device appear here with their live onchain status.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line/70">
              {stored.map((s) => (
                <RequestRow key={s.requestId} stored={s} />
              ))}
            </ul>
          )}
        </Card>
      )}
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Status always comes from the chain, never from this device.
      </p>
    </div>
  )
}

export function RequestView() {
  return (
    <>
      <PageTitle title="Request" subtitle="Ask anyone for an exact amount of USDC." />
      <Gate message="Connect the wallet that should receive the payment.">
        <RequestFlow />
      </Gate>
    </>
  )
}
