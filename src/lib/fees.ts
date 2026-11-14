import { erc20Abi, type Address, type PublicClient } from 'viem'
import { paynoraAbi } from '@/paynoraAbi'
import { CHAIN_ID, PAYNORA_ADDRESS, USDC_ADDRESS } from '@/paynora'
import { Amount, gasTokenToUsdc, usdcToGasToken } from '@/onchain-money'
import type { SignedRequest } from '@/lib/requests'

export interface FeeJob {
  to: Address
  amount: bigint
  note: string
  request?: SignedRequest
}

/** Max fee per gas the wallet is likely to use, falling back to the node's gas price. */
export async function getMaxFeePerGas(client: PublicClient): Promise<bigint> {
  try {
    return (await client.estimateFeesPerGas()).maxFeePerGas
  } catch {
    return client.getGasPrice()
  }
}

/** Gas for the payment call itself. Simulates the call, so contract reverts surface here. */
export function estimatePayGas(client: PublicClient, account: Address, job: FeeJob): Promise<bigint> {
  if (!PAYNORA_ADDRESS) throw new Error('Paynora is not configured')
  if (job.request) {
    const { payee, amount, requestId, note, expiry, signature } = job.request
    return client.estimateContractGas({
      address: PAYNORA_ADDRESS,
      abi: paynoraAbi,
      account,
      functionName: 'payRequest',
      args: [{ payee, amount, requestId, note, expiry }, signature],
    })
  }
  return client.estimateContractGas({
    address: PAYNORA_ADDRESS,
    abi: paynoraAbi,
    account,
    functionName: 'pay',
    args: [job.to, job.amount, job.note],
  })
}

export interface FeeEstimate {
  approvalNeeded: boolean
  /** Fee for the next transaction the wallet will ask for, in the 18-decimal gas view. */
  nextFee: Amount
}

/** Estimates the fee of the NEXT transaction: the exact-amount approval if needed, else the payment itself. */
export async function estimateNextFee(client: PublicClient, account: Address, job: FeeJob): Promise<FeeEstimate> {
  if (!PAYNORA_ADDRESS) throw new Error('Paynora is not configured')
  const [allowance, maxFee] = await Promise.all([
    client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [account, PAYNORA_ADDRESS] }),
    getMaxFeePerGas(client),
  ])
  const approvalNeeded = allowance < job.amount
  const gas = approvalNeeded
    ? await client.estimateContractGas({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [PAYNORA_ADDRESS, job.amount], account })
    : await estimatePayGas(client, account, job)
  return { approvalNeeded, nextFee: Amount.fromRaw(gas * maxFee, 18) }
}

/** Rounds a gas-view fee UP to the 6-decimal USDC view for display, so the shown fee is never understated. */
export function feeForDisplay(fee: Amount): Amount {
  const down = gasTokenToUsdc(CHAIN_ID, fee, 'trunc')
  return usdcToGasToken(CHAIN_ID, down).lt(fee) ? down.add(Amount.fromRaw(1n, down.decimals)) : down
}
