import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { usePublicClient, useWriteContract } from 'wagmi'
import { Button, cx } from '@/components/ui'
import { useNetworkStatus, useWallet } from '@/hooks/useWallet'
import { classifyError } from '@/lib/errors'
import { CHAIN_ID, USDC_ADDRESS } from '@/paynora'
import { TEST_ACCOUNTS } from '@/testChain'
import { activeTestAccountIndex, setActiveTestAccount } from '@/testWallet'

const mintAbi = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const

const MINT_RAW = 100_000_000n // 100 test USDC

/**
 * Always-visible marker for Preview Test Mode, plus the test-only controls: switch between two
 * test accounts (so a request can be paid by the "other" person) and mint worthless test USDC.
 */
export function TestModeBanner() {
  const { address, isConnected } = useWallet()
  const { isError } = useNetworkStatus()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [minting, setMinting] = useState(false)
  const [note, setNote] = useState<string>()
  const [, force] = useState(0)

  const activeIndex = address ? Math.max(0, TEST_ACCOUNTS.findIndex((a) => a.address.toLowerCase() === address.toLowerCase())) : activeTestAccountIndex()

  const mint = async () => {
    if (!address || !client || minting) return
    setMinting(true)
    setNote(undefined)
    try {
      const hash = await writeContractAsync({ address: USDC_ADDRESS, abi: mintAbi, functionName: 'mint', args: [address, MINT_RAW], chainId: CHAIN_ID })
      await client.waitForTransactionReceipt({ hash })
      await queryClient.invalidateQueries()
      setNote('Minted 100 test USDC.')
    } catch (e) {
      setNote(classifyError(e).message)
    } finally {
      setMinting(false)
    }
  }

  return (
    <div className="mx-auto mt-3 max-w-2xl px-4">
      <div role="note" className="rounded-2xl border border-warn/40 bg-warn/10 p-3.5">
        <p className="flex items-start gap-2 text-[13px] font-semibold text-ink">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <span>
            Preview Test Mode. Local test chain, not Arc Mainnet. Test USDC has no value.
            <span className="block font-normal text-muted">
              Real contract code and real transactions on a throwaway chain that resets when it restarts. Arc Mainnet needs your own deployment (<code className="font-mono text-xs">bun run configure:paynora</code>).
            </span>
          </span>
        </p>
        {isError ? (
          <p className="mt-2 text-[13px] text-bad" role="alert">
            Test chain offline. Start it with <code className="font-mono text-xs">bun run test-chain</code>, then reload.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Test account" className="inline-flex rounded-xl bg-sunk p-1">
              {TEST_ACCOUNTS.map((a, i) => (
                <button
                  key={a.address}
                  aria-pressed={activeIndex === i}
                  onClick={() => {
                    setActiveTestAccount(i as 0 | 1)
                    force((n) => n + 1)
                  }}
                  className={cx('min-h-9 rounded-lg px-3 text-xs font-semibold transition', activeIndex === i ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <Button variant="secondary" className="min-h-9 px-3 text-xs" disabled={!isConnected} loading={minting} onClick={() => void mint()}>
              Get 100 test USDC
            </Button>
            {note && (
              <span role="status" className="text-xs text-muted">
                {note}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
