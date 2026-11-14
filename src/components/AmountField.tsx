import { TokenUSDC } from '@web3icons/react'
import { FieldError, Label, cx } from '@/components/ui'
import { USDC_DECIMALS } from '@/paynora'

/** Keeps only a valid in-progress USDC amount: digits, one dot, at most six decimals. */
export function sanitizeAmount(input: string): string {
  const cleaned = input.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  const fraction = rest.join('').slice(0, USDC_DECIMALS)
  const w = whole.replace(/^0+(?=\d)/, '')
  return rest.length > 0 ? `${w}.${fraction}` : w
}

export function AmountField({
  value,
  onChange,
  error,
  disabled,
  hint,
}: {
  value: string
  onChange: (next: string) => void
  error?: string
  disabled?: boolean
  hint?: string
}) {
  return (
    <div>
      <Label htmlFor="amount">Amount</Label>
      <div
        className={cx(
          'flex items-center gap-3 rounded-3xl border bg-sunk/70 px-5 py-4 transition focus-within:bg-card',
          error ? 'border-bad/50' : 'border-line focus-within:border-ink/40',
        )}
      >
        <input
          id="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(sanitizeAmount(e.target.value))}
          aria-invalid={Boolean(error)}
          className="num min-w-0 flex-1 bg-transparent font-display text-[40px] font-bold leading-none tracking-[-0.03em] placeholder:text-muted/40 focus:outline-none"
        />
        <span className="flex shrink-0 items-center gap-2 rounded-full bg-card px-3 py-1.5 text-sm font-semibold">
          <TokenUSDC variant="branded" size={20} /> USDC
        </span>
      </div>
      {error ? <FieldError>{error}</FieldError> : hint ? <p className="mt-1.5 text-[13px] text-muted">{hint}</p> : null}
    </div>
  )
}
