import { HandCoins, Send, ShieldCheck, Zap } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { Card, Skeleton, Pill } from '@/components/ui'
import { ConfigCard, ConnectCard } from '@/components/Gate'
import { PaymentOverview } from '@/components/PaymentOverview'
import { NetworkPill } from '@/components/Shell'
import { useUsdcBalance, useWallet } from '@/hooks/useWallet'
import { Link, pathFor } from '@/lib/router'
import { fmtUsdc, shortAddress } from '@/lib/format'
import { CopyButton } from '@/components/ui'
import { addressUrl, NETWORK_NAME, configProblem } from '@/paynora'

function Hero() {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ember/15 blur-3xl" aria-hidden />
      <Pill tone="muted" className="mb-4">
        <Zap className="h-3 w-3" aria-hidden /> USDC on {NETWORK_NAME}
      </Pill>
      <h1 className="text-[34px] font-bold leading-[1.05] sm:text-[40px]">Send money the way you send a message.</h1>
      <p className="mt-3 max-w-md text-[15px] text-muted">
        Paynora moves USDC directly from wallet to wallet. No custody, no fees from us, and every payment is confirmed against the real receipt.
      </p>
      <ul className="mt-5 space-y-2 text-sm text-muted">
        <li className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-ok" aria-hidden /> Paynora never holds your funds
        </li>
        <li className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-ok" aria-hidden /> Success is shown only after onchain verification
        </li>
      </ul>
    </Card>
  )
}

function BalanceCard({ address }: { address: `0x${string}` }) {
  const { data, isLoading, isError, refetch } = useUsdcBalance(address)
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-ember/12 blur-3xl" aria-hidden />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">USDC balance</p>
        <TokenUSDC variant="branded" size={24} />
      </div>
      <div className="mt-2 min-h-[56px]">
        {isLoading ? (
          <Skeleton className="h-12 w-48" />
        ) : isError || data === undefined ? (
          <div>
            <p className="text-[15px] text-bad">Could not read your balance from Arc.</p>
            <button onClick={() => void refetch()} className="mt-1 text-sm font-semibold underline underline-offset-2">
              Try again
            </button>
          </div>
        ) : (
          <p className="num font-display text-[48px] font-bold leading-none tracking-[-0.04em]">
            {fmtUsdc(data)}
            <span className="ml-2 text-lg font-semibold text-muted">USDC</span>
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {addressUrl(address) ? (
          <a href={addressUrl(address)} target="_blank" rel="noopener noreferrer" className="num rounded-full bg-sunk px-3 py-1.5 font-mono text-xs text-muted hover:text-ink" title={address}>
            {shortAddress(address)}
          </a>
        ) : (
          <span className="num rounded-full bg-sunk px-3 py-1.5 font-mono text-xs text-muted" title={address}>
            {shortAddress(address)}
          </span>
        )}
        <NetworkPill />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link to={pathFor('pay')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-[15px] font-semibold text-brand-ink transition hover:opacity-90">
          <Send className="h-4 w-4" aria-hidden /> Send
        </Link>
        <Link to={pathFor('request')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-sunk px-4 text-[15px] font-semibold transition hover:bg-line/60">
          <HandCoins className="h-4 w-4" aria-hidden /> Request
        </Link>
      </div>
    </Card>
  )
}

export function Dashboard() {
  const { address, isConnected, isConnecting, wrongNetwork } = useWallet()
  if (isConnecting) return <Skeleton className="h-72 w-full rounded-3xl" />
  if (!isConnected || !address) {
    return (
      <div className="space-y-4">
        <Hero />
        <ConnectCard message="Connect an EVM wallet such as MetaMask to see your balance and pay." />
        <div className="flex justify-center">
          <NetworkPill />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <BalanceCard address={address} />
      {configProblem && <ConfigCard />}
      {!wrongNetwork && <PaymentOverview address={address} />}
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Your address</p>
          <p className="num truncate font-mono text-xs text-muted">{address}</p>
        </div>
        <CopyButton value={address} />
      </Card>
    </div>
  )
}
