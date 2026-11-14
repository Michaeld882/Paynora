import { useModal } from 'connectkit'
import { useConnect, useDisconnect } from 'wagmi'
import { TEST_MODE } from '@/mode'

/**
 * One entry point for "connect a wallet". On Arc Mainnet it opens the wallet picker. In Preview
 * Test Mode it connects the in-app test wallet directly (there is nothing to pick).
 */
export function useConnectWallet() {
  const { setOpen } = useModal()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  const open = () => {
    if (TEST_MODE && connectors[0]) connect({ connector: connectors[0] })
    else setOpen(true)
  }
  return { open, isConnecting: isPending, disconnect, testMode: TEST_MODE }
}
