import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { CHAIN_ID, PAYNORA_ADDRESS } from '@/paynora'
import { estimateNextFee, type FeeJob } from '@/lib/fees'
import { classifyError } from '@/lib/errors'

export function useFeeEstimate(job: FeeJob | undefined) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const query = useQuery({
    queryKey: ['fee', address, job?.to, job?.amount.toString(), job?.note, job?.request?.requestId],
    enabled: Boolean(client && address && job && PAYNORA_ADDRESS),
    refetchInterval: 20_000,
    retry: 1,
    queryFn: () => {
      if (!client || !address || !job) throw new Error('Not ready')
      return estimateNextFee(client, address, job)
    },
  })
  return { ...query, errorMessage: query.error ? classifyError(query.error).message : undefined }
}
