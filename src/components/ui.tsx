import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

export const cx = clsx

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-3xl border border-line/80 bg-card/90 p-5 shadow-card backdrop-blur-sm sm:p-6', className)}>
      {children}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90 shadow-[0_8px_20px_-10px_rgb(14_26_43/0.7)]',
  secondary: 'bg-sunk text-ink hover:bg-line/60 border border-line',
  ghost: 'bg-transparent text-ink hover:bg-sunk',
  danger: 'bg-bad/10 text-bad hover:bg-bad/20 border border-bad/30',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  block?: boolean
}

export function Button({ variant = 'primary', loading, block, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <motion.button
      whileTap={disabled || loading ? undefined : { scale: 0.98 }}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        block && 'w-full',
        VARIANTS[variant],
        className,
      )}
      {...(rest as object)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </motion.button>
  )
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-2xl border border-line bg-sunk/70 px-4 py-3.5 text-[15px] text-ink placeholder:text-muted/70 transition focus:border-ink/40 focus:bg-card focus:outline-none disabled:opacity-60'

export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] text-bad">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

export function CopyButton({ value, label = 'Copy', className, disabled }: { value: string; label?: string; className?: string; disabled?: boolean }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      setTimeout(() => setDone(false), 1800)
    } catch {
      setDone(false)
    }
  }
  return (
    <Button variant="secondary" disabled={disabled} onClick={() => void copy()} className={cx('min-h-11', className)}>
      {done ? <Check className="h-4 w-4 text-ok" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {done ? 'Copied' : label}
    </Button>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-xl', className)} aria-hidden />
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted'
const TONES: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/12 text-bad',
  muted: 'bg-sunk text-muted',
}

export function Pill({ tone = 'muted', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function Notice({ tone = 'warn', title, children, action }: { tone?: 'warn' | 'bad' | 'muted'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center', tone === 'bad' ? 'border-bad/30 bg-bad/8' : tone === 'warn' ? 'border-warn/30 bg-warn/10' : 'border-line bg-sunk/60')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sunk text-muted">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <p className="mt-1.5 max-w-xs text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-[28px] font-bold leading-tight sm:text-[32px]">{title}</h1>
      {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
    </div>
  )
}
