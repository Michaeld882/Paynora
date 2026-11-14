import { useCallback } from 'react'
import { erc20Abi, type Address } from 'viem'
import { useAccount, useBlockNumber, useReadContract, useSwitchChain } from 'wagmi'
import { CHAIN_ID, USDC_ADDRESS } from '@/paynora'

export function useWallet() {
  const { address, isConnecting, isReconnecting, chainId } = useAccount()
  // Treat a known address as connected even while wagmi re-syncs (status 'reconnecting'), so form
  // state is never thrown away by a momentary connection-status flicker.
  const isConnected = Boolean(address)
  const { switchChainAsync, isPending: isSwitching, error: switchError } = useSwitchChain()
  const wrongNetwork = isConnected && chainId !== CHAIN_ID

  const switchToArc = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: CHAIN_ID })
      return true
    } catch {
      return false
    }
  }, [switchChainAsync])

  return {
    address: address,
    isConnected,
    isConnecting: !isConnected && (isConnecting || isReconnecting),
    walletChainId: chainId,
    wrongNetwork,
    switchToArc,
    isSwitching,
    switchError,
  }
}

/** The single USDC balance, read from the 6-decimal ERC-20 view (the same pool as Arc's gas token). */
export function useUsdcBalance(address: Address | undefined) {
  return useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  })
}

/** Live head of Arc Mainnet from the public RPC; works without a wallet. */
export function useNetworkStatus() {
  const { data: block, isError, isLoading } = useBlockNumber({ chainId: CHAIN_ID, watch: { pollingInterval: 6000 } })
  return { block, isError: isError && block === undefined, isLoading }
}
