/**
 * Pay flow state machine: switch network -> checks -> exact-amount USDC approval (only if
 * needed) -> pay / payRequest -> receipt verification (handled by the journal watcher).
 */
import { useCallback, useRef, useState } from 'react'
import { erc20Abi, type Address, type Hex } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { paynoraAbi } from '@/paynoraAbi'
import { CHAIN_ID, PAYNORA_ADDRESS, USDC_ADDRESS } from '@/paynora'
import { Amount, gasTokenDecimalsFor, usdcDecimalsFor, usdcToGasToken } from '@/onchain-money'
import { classifyError, type TxError, type TxErrorKind } from '@/lib/errors'
import { estimatePayGas, getMaxFeePerGas } from '@/lib/fees'
import { journal, useJournal } from '@/lib/pending'
import type { SignedRequest } from '@/lib/requests'
import { useWallet } from '@/hooks/useWallet'

export interface PayJob {
  to: Address
  amount: bigint
  note: string
  request?: SignedRequest
}

export type Phase =
  | 'idle'
  | 'preparing'
  | 'switching'
  | 'approve-wallet'
  | 'approve-chain'
  | 'pay-wallet'
  | 'submitted'
  | 'rejected'
  | 'error'

const ZERO_ID: Hex = `0x${'0'.repeat(64)}`

class Preflight extends Error {
  kind: TxErrorKind
  constructor(kind: TxErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export function usePayment() {
  const { address, chainId } = useAccount()
  const { switchToArc } = useWallet()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const entries = useJournal(address)
  const lock = useRef(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [approveHash, setApproveHash] = useState<Hex>()
  const [entryId, setEntryId] = useState<string>()
  const [error, setError] = useState<TxError>()

  const entry = entryId ? entries.find((e) => e.id === entryId) : undefined

  const reset = useCallback(() => {
    if (lock.current) return
    setPhase('idle')
    setApproveHash(undefined)
    setEntryId(undefined)
    setError(undefined)
  }, [])

  const run = useCallback(
    async (job: PayJob) => {
      if (lock.current) return // duplicate-submission guard: one flow at a time
      if (!address || !client || !PAYNORA_ADDRESS) return
      lock.current = true
      setError(undefined)
      setApproveHash(undefined)
      setEntryId(undefined)
        try {
        setPhase('preparing')
        const requestId = job.request?.requestId ?? ZERO_ID
        const duplicate = journal
          .all()
          .find(
            (e) =>
              e.status === 'pending' &&
              e.from.toLowerCase() === address.toLowerCase() &&
              (job.request
                ? e.requestId === requestId
                : e.requestId === ZERO_ID && e.to.toLowerCase() === job.to.toLowerCase() && e.amount === job.amount.toString() && e.note === job.note),
          )
        if (duplicate) throw new Preflight('unknown', 'An identical payment is still pending. Wait for it to finish before sending again.')

        if (chainId !== CHAIN_ID) {
          setPhase('switching')
          if (!(await switchToArc())) throw new Preflight('wrong-chain', 'Switch your wallet to Arc Mainnet to continue.')
        }
        setPhase('preparing')

        const balance = await client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
        if (balance < job.amount) throw new Preflight('insufficient', 'Your USDC balance is lower than this payment.')

        if (job.request) {
          const open = await client.readContract({ address: PAYNORA_ADDRESS, abi: paynoraAbi, functionName: 'isRequestOpen', args: [job.request.payee, job.request.requestId] })
          if (!open) throw new Preflight('reverted', 'This payment request was already paid or cancelled.')
          const latest = await client.getBlock()
          if (latest.timestamp > job.request.expiry) throw new Preflight('reverted', 'This payment request has expired.')
        }

        const allowance = await client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [address, PAYNORA_ADDRESS] })
        if (allowance < job.amount) {
          setPhase('approve-wallet')
          const approval = await writeContractAsync({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: 'approve',
            args: [PAYNORA_ADDRESS, job.amount], // exact amount, never unlimited
            chainId: CHAIN_ID,
          })
          setApproveHash(approval)
          setPhase('approve-chain')
          const receipt = await client.waitForTransactionReceipt({ hash: approval })
          if (receipt.status !== 'success') throw new Preflight('reverted', 'The USDC approval failed. Nothing was sent.')
          const after = await client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [address, PAYNORA_ADDRESS] })
          if (after < job.amount) throw new Preflight('reverted', 'The approval did not register. Nothing was sent.')
        }

        // Simulating also surfaces contract reverts before the wallet is ever opened.
        const gas = await estimatePayGas(client, address, job)
        const maxFee = await getMaxFeePerGas(client)
        const nativeBalance = Amount.fromRaw(await client.getBalance({ address }), gasTokenDecimalsFor(CHAIN_ID))
        const needed = usdcToGasToken(CHAIN_ID, Amount.fromRaw(job.amount, usdcDecimalsFor(CHAIN_ID))).add(
          Amount.fromRaw(gas * maxFee, gasTokenDecimalsFor(CHAIN_ID)),
        )
        if (nativeBalance.lt(needed)) throw new Preflight('insufficient', 'Not enough USDC to cover the amount plus the network fee.')

        setPhase('pay-wallet')
        const hash = job.request
          ? await writeContractAsync({
              address: PAYNORA_ADDRESS,
              abi: paynoraAbi,
              chainId: CHAIN_ID,
              functionName: 'payRequest',
              args: [
                { payee: job.request.payee, amount: job.request.amount, requestId: job.request.requestId, note: job.request.note, expiry: job.request.expiry },
                job.request.signature,
              ],
            })
          : await writeContractAsync({
              address: PAYNORA_ADDRESS,
              abi: paynoraAbi,
              chainId: CHAIN_ID,
              functionName: 'pay',
              args: [job.to, job.amount, job.note],
            })
        const id = `${Date.now()}-${hash.slice(2, 10)}`
        journal.add({
          id,
          hash,
          from: address,
          to: job.to,
          amount: job.amount.toString(),
          requestId,
          note: job.note,
          createdAt: Math.floor(Date.now() / 1000),
          status: 'pending',
        })
        setEntryId(id)
        setPhase('submitted')
      } catch (e) {
        const known = e instanceof Preflight ? { kind: e.kind, message: e.message } : classifyError(e)
        setError(known)
        setPhase(known.kind === 'rejected' ? 'rejected' : 'error')
      } finally {
        lock.current = false
      }
    },
    [address, chainId, client, switchToArc, writeContractAsync],
  )

  return { phase, approveHash, entry, error, run, reset, busy: phase !== 'idle' && phase !== 'submitted' && phase !== 'rejected' && phase !== 'error' }
}
