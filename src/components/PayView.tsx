import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getAddress, isAddress } from 'viem'
import { ArrowRight, ShieldAlert } from 'lucide-react'
import { AmountField, sanitizeAmount } from '@/components/AmountField'
import { Gate } from '@/components/Gate'
import { TxProgress } from '@/components/TxProgress'
import { Button, Card, FieldError, Label, Notice, PageTitle, inputClass } from '@/components/ui'
import { useFeeEstimate } from '@/hooks/useFee'
import { usePayment } from '@/hooks/usePayment'
import { useUsdcBalance, useWallet } from '@/hooks/useWallet'
import { feeForDisplay } from '@/lib/fees'
import { byteLength, fmtUsdc } from '@/lib/format'
import { navigate, pathFor } from '@/lib/router'
import { Amount, parseAmount, usdcToGasToken } from '@/onchain-money'
import { CHAIN_ID, MAX_NOTE_BYTES, PAYNORA_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from '@/paynora'

export function Rows({ rows }: { rows: [string, string | JSX.Element][] }) {
  return (
    <dl className="space-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4">
          <dt className="shrink-0 text-muted">{k}</dt>
          <dd className="num min-w-0 break-all text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function PayFlow({ prefill, prefillAmount, prefillNote }: { prefill: string; prefillAmount: string; prefillNote: string }) {
  const { address } = useWallet()
  const balance = useUsdcBalance(address)
  const payment = usePayment()
  const queryClient = useQueryClient()
  const [to, setTo] = useState(isAddress(prefill) ? prefill : '')
  const [amountText, setAmountText] = useState(() => sanitizeAmount(prefillAmount))
  const [note, setNote] = useState(() => (byteLength(prefillNote) <= MAX_NOTE_BYTES ? prefillNote : ''))
  const [step, setStep] = useState<'form' | 'review' | 'tx'>('form')
  const [touched, setTouched] = useState(false)

  const errors = useMemo(() => {
    const out: { to?: string; amount?: string; note?: string } = {}
    const target = to.trim()
    if (!target) out.to = 'Enter a recipient address.'
    else if (!isAddress(target)) out.to = 'That is not a valid wallet address (check the checksum).'
    else if (address && target.toLowerCase() === address.toLowerCase()) out.to = 'You cannot pay your own address.'
    else if ([PAYNORA_ADDRESS, USDC_ADDRESS, '0x0000000000000000000000000000000000000000'].some((a) => a && a.toLowerCase() === target.toLowerCase())) {
      out.to = 'This is a contract or burn address. Funds sent here would be lost.'
    }
    let amount: Amount | undefined
    if (!amountText || amountText === '.') out.amount = 'Enter an amount.'
    else if (Number(amountText) === 0) out.amount = 'Amount must be greater than zero.'
    else {
      try {
        amount = parseAmount(CHAIN_ID, amountText)
        if (amount.isZero()) out.amount = 'Amount must be greater than zero.'
        else if (balance.data !== undefined && amount.raw > balance.data) out.amount = `Insufficient USDC. You have ${fmtUsdc(balance.data)}.`
      } catch {
        out.amount = 'Use at most 6 decimal places.'
      }
    }
    if (byteLength(note) > MAX_NOTE_BYTES) out.note = `Notes are limited to ${MAX_NOTE_BYTES} bytes.`
    return { ...out, amount: out.amount, parsed: amount }
  }, [to, amountText, note, address, balance.data])

  const valid = !errors.to && !errors.amount && !errors.note && errors.parsed !== undefined
  const job = valid && errors.parsed ? { to: getAddress(to.trim()), amount: errors.parsed.raw, note: note.trim() } : undefined
  const fee = useFeeEstimate(step === 'review' ? job : undefined)

  const confirmed = payment.entry?.status === 'confirmed'
  useEffect(() => {
    if (confirmed) void queryClient.invalidateQueries()
  }, [confirmed, queryClient])

  const feeShown = fee.data ? feeForDisplay(fee.data.nextFee) : undefined
  const shortfall =
    job &&
    fee.data &&
    balance.data !== undefined &&
    usdcToGasToken(CHAIN_ID, Amount.fromRaw(balance.data, USDC_DECIMALS)).lt(
      usdcToGasToken(CHAIN_ID, Amount.fromRaw(job.amount, USDC_DECIMALS)).add(fee.data.nextFee),
    )

  const summary = job ? (
    <Rows
      rows={[
        ['To', job.to],
        ['Amount', `${fmtUsdc(job.amount)} USDC`],
        ...(job.note ? ([['Note', job.note]] as [string, string][]) : []),
      ]}
    />
  ) : null

  const reset = () => {
    payment.reset()
    setStep('form')
  }

  if (step === 'tx' && job) {
    return (
      <TxProgress
        payment={payment}
        summary={summary}
        onDone={() => {
          payment.reset()
          navigate(pathFor('home'))
        }}
        onNew={() => {
          payment.reset()
          setAmountText('')
          setNote('')
          setStep('form')
        }}
        onEdit={() => {
          payment.reset()
          setStep('review')
        }}
        onRetry={() => {
          payment.reset()
          void payment.run(job)
        }}
      />
    )
  }

  if (step === 'review' && job) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Review payment</h2>
        <div className="rounded-2xl bg-sunk/70 p-4">{summary}</div>
        <div className="mt-4 rounded-2xl border border-line p-4">
          <Rows
            rows={[
              [
                fee.data?.approvalNeeded ? 'Network fee (approval step)' : 'Network fee',
                fee.isLoading ? 'Estimating…' : feeShown ? `≈ ${feeShown.toString()} USDC` : 'Unavailable',
              ],
              ['Wallet confirmations', fee.data ? (fee.data.approvalNeeded ? '2 (approve, then pay)' : '1') : '…'],
            ]}
          />
          <p className="mt-3 text-xs text-muted">
            Fees on Arc are paid in USDC from the same balance.
            {fee.data?.approvalNeeded && ' You approve exactly this amount, never unlimited. The payment fee is checked again after approval.'}
          </p>
        </div>
        {fee.errorMessage && <div className="mt-4"><FieldError>{fee.errorMessage}</FieldError></div>}
        {shortfall && <div className="mt-4"><FieldError>Not enough USDC to cover the amount plus the network fee.</FieldError></div>}
        <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden /> Onchain payments are irreversible. Check the full address above.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setStep('form')}>
            Edit
          </Button>
          <Button
            disabled={!fee.data || Boolean(shortfall) || payment.busy}
            loading={fee.isLoading}
            onClick={() => {
              setStep('tx')
              void payment.run(job)
            }}
          >
            Confirm and pay
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (valid) setStep('review')
      }}
      noValidate
    >
      <Card className="space-y-5">
        <AmountField
          value={amountText}
          onChange={setAmountText}
          error={touched || amountText ? errors.amount : undefined}
          hint={balance.data !== undefined ? `Available: ${fmtUsdc(balance.data)} USDC` : balance.isError ? 'Could not load your balance.' : 'Loading balance…'}
        />
        <div>
          <Label htmlFor="to">Recipient</Label>
          <input id="to" className={inputClass} placeholder="0x…" autoComplete="off" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value.trim())} aria-invalid={Boolean(errors.to)} />
          {(touched || to) && errors.to && <FieldError>{errors.to}</FieldError>}
        </div>
        <div>
          <Label htmlFor="note">Note (optional, public)</Label>
          <input id="note" className={inputClass} placeholder="Dinner, invoice #42…" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-1.5 flex justify-between text-[13px] text-muted">
            <span>{errors.note ? <span className="text-bad">{errors.note}</span> : 'Visible to anyone on the blockchain.'}</span>
            <span className="num">
              {byteLength(note)}/{MAX_NOTE_BYTES}
            </span>
          </div>
        </div>
        <Button type="submit" block disabled={touched && !valid}>
          Review payment <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </Card>
      {payment.phase !== 'idle' && payment.phase !== 'submitted' && (
        <div className="mt-4">
          <Notice tone="muted" title="Previous attempt" action={<Button variant="ghost" onClick={reset}>Clear</Button>}>
            {payment.error?.message}
          </Notice>
        </div>
      )}
    </form>
  )
}

export function PayView({ search }: { search: URLSearchParams }) {
  return (
    <>
      <PageTitle title="Pay" subtitle="Send USDC to any wallet on Arc." />
      <Gate message="Connect a wallet to send USDC.">
        <PayFlow prefill={search.get('to') ?? ''} prefillAmount={search.get('amt') ?? ''} prefillNote={search.get('memo') ?? ''} />
      </Gate>
    </>
  )
}
