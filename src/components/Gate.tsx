import type { ReactNode } from 'react'
import { Network, Settings2, Wallet } from 'lucide-react'
import { Button, Card, EmptyState, Skeleton } from '@/components/ui'
import { useConnectWallet } from '@/hooks/useConnectWallet'
import { useWallet } from '@/hooks/useWallet'
import { CHAIN, NETWORK_NAME, PAYNORA_ADDRESS, configProblem } from '@/paynora'

export function ConfigCard() {
  return (
    <Card>
      <EmptyState icon={<Settings2 className="h-6 w-6" aria-hidden />} title="Paynora contract not configured">
        {configProblem} Deploy <code className="font-mono text-xs">contracts/Paynora.sol</code> to Arc Mainnet yourself, then run{' '}
        <code className="break-all font-mono text-xs">bun run configure:paynora &lt;address&gt; --tx &lt;deploy-tx-hash&gt;</code>. It verifies the contract onchain and
        sets <code className="font-mono text-xs">VITE_PAYNORA_ADDRESS</code> and <code className="font-mono text-xs">VITE_PAYNORA_DEPLOY_BLOCK</code> in{' '}
        <code className="font-mono text-xs">.env</code>. No payment data is shown until then.
      </EmptyState>
    </Card>
  )
}

export function ConnectCard({ message = 'Connect a wallet to continue.' }: { message?: string }) {
  const { open, isConnecting, testMode } = useConnectWallet()
  return (
    <Card>
      <EmptyState
        icon={<Wallet className="h-6 w-6" aria-hidden />}
        title="Connect your wallet"
        action={
          <Button onClick={open} loading={isConnecting}>
            {testMode ? 'Connect test wallet' : 'Connect wallet'}
          </Button>
        }
      >
        {message}
      </EmptyState>
    </Card>
  )
}

export function SwitchCard() {
  const { switchToArc, isSwitching } = useWallet()
  return (
    <Card>
      <EmptyState
        icon={<Network className="h-6 w-6" aria-hidden />}
        title="Switch to Arc Mainnet"
        action={
          <Button onClick={() => void switchToArc()} loading={isSwitching}>
            Switch network
          </Button>
        }
      >
        Paynora only works on {NETWORK_NAME} (chain {CHAIN.chainId}). Your wallet is connected to a different network.
      </EmptyState>
    </Card>
  )
}

/** Renders children only when the wallet is connected on Arc Mainnet and the contract is configured. */
export function Gate({ children, needsContract = true, message }: { children: ReactNode; needsContract?: boolean; message?: string }) {
  const { isConnected, isConnecting, wrongNetwork } = useWallet()
  if (isConnecting) return <Skeleton className="h-64 w-full rounded-3xl" />
  if (!isConnected) return <ConnectCard message={message} />
  if (wrongNetwork) return <SwitchCard />
  if (needsContract && (configProblem || !PAYNORA_ADDRESS)) return <ConfigCard />
  return <>{children}</>
}
