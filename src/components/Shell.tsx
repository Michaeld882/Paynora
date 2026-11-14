import { useCallback, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { History, HandCoins, Home, Moon, QrCode, Send, Sun, Wallet } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Notice, Pill, cx } from '@/components/ui'
import { Link, pathFor, useRoute, type RouteName } from '@/lib/router'
import { shortAddress } from '@/lib/format'
import { useConnectWallet } from '@/hooks/useConnectWallet'
import { useNetworkStatus, useWallet } from '@/hooks/useWallet'
import { TestModeBanner } from '@/components/TestModeBanner'
import { CHAIN, NETWORK_NAME } from '@/paynora'
import { TEST_MODE } from '@/mode'

const TABS: { route: Exclude<RouteName, 'notfound' | 'open'>; label: string; icon: typeof Home }[] = [
  { route: 'home', label: 'Home', icon: Home },
  { route: 'pay', label: 'Pay', icon: Send },
  { route: 'request', label: 'Request', icon: HandCoins },
  { route: 'receive', label: 'Receive', icon: QrCode },
  { route: 'activity', label: 'Activity', icon: History },
]

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('paynora:theme', next ? 'dark' : 'light')
    } catch {
      // Theme still applies for this session.
    }
    setDark(next)
  }, [])
  return { dark, toggle }
}

export function NetworkPill() {
  const { block, isError, isLoading } = useNetworkStatus()
  const tone = isError ? 'bad' : block === undefined ? 'muted' : 'ok'
  return (
    <Pill tone={tone} className="num">
      <span className={cx('h-1.5 w-1.5 rounded-full', isError ? 'bg-bad' : block === undefined ? 'bg-muted' : 'bg-ok')} aria-hidden />
      {isError ? (TEST_MODE ? 'Test chain offline' : 'RPC unreachable') : isLoading || block === undefined ? (TEST_MODE ? 'Connecting to test chain…' : 'Connecting to Arc…') : `${NETWORK_NAME} · #${block.toLocaleString()}`}
    </Pill>
  )
}

function WalletButton() {
  const { address, isConnected } = useWallet()
  const { open, isConnecting, disconnect, testMode } = useConnectWallet()
  return (
    <button
      onClick={() => (isConnected && testMode ? disconnect() : open())}
      disabled={isConnecting}
      title={isConnected && testMode ? 'Disconnect the test wallet' : undefined}
      className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-card px-3.5 text-sm font-semibold text-ink transition hover:bg-sunk disabled:opacity-60"
    >
      <Wallet className="h-4 w-4" aria-hidden />
      {isConnecting ? 'Connecting…' : isConnected && address ? <span className="num">{shortAddress(address)}</span> : 'Connect'}
    </button>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { route } = useRoute()
  const { dark, toggle } = useTheme()
  const { isConnected, wrongNetwork, switchToArc, isSwitching } = useWallet()

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <Link to={pathFor('home')} aria-label="Paynora home" className="rounded-xl">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={toggle}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-ink transition hover:bg-sunk"
            >
              {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </button>
            <WalletButton />
          </div>
        </div>
        <nav aria-label="Primary" className="mx-auto max-w-2xl px-3 pb-2">
          <ul className="grid grid-cols-5 gap-1 rounded-2xl bg-sunk/80 p-1">
            {TABS.map(({ route: r, label, icon: Icon }) => {
              const active = route === r || (r === 'request' && route === 'open')
              return (
                <li key={r}>
                  <Link
                    to={pathFor(r)}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors sm:flex-row sm:gap-1.5 sm:text-[13px]',
                      active ? 'text-ink' : 'text-muted hover:text-ink',
                    )}
                  >
                    {active && <motion.span layoutId="tab-bg" className="absolute inset-0 rounded-xl bg-card shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <Icon className="relative h-[18px] w-[18px]" aria-hidden />
                    <span className="relative">{label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </header>

      {TEST_MODE && <TestModeBanner />}

      {isConnected && wrongNetwork && (
        <div className="mx-auto mt-4 max-w-2xl px-4">
          <Notice
            tone="bad"
            title="Wrong network"
            action={
              <button
                onClick={() => void switchToArc()}
                disabled={isSwitching}
                className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink disabled:opacity-60"
              >
                {isSwitching ? 'Switching…' : 'Switch to Arc Mainnet'}
              </button>
            }
          >
            Your wallet is not on {NETWORK_NAME} (chain {CHAIN.chainId}). Payments are disabled until you switch.
          </Notice>
        </div>
      )}

      <main className="mx-auto max-w-2xl px-4 pt-5">
        {/* Enter-only transition. An exit animation would keep the old page mounted while the router
            already renders the new route inside it, mounting the page twice and wiping form input. */}
        <motion.div key={route} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {children}
        </motion.div>
      </main>
    </div>
  )
}
