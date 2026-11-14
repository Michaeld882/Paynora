import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { BadgeCheck, CircleSlash, Clock, LinkIcon } from 'lucide-react'
import { ConfigCard } from '@/components/Gate'
import { Rows } from '@/components/PayView'
import { TxProgress } from '@/components/TxProgress'
import { Button, Card, EmptyState, FieldError, PageTitle, Skeleton } from '@/components/ui'
import { useConnectWallet } from '@/hooks/useConnectWallet'
import { useFeeEstimate } from '@/hooks/useFee'
import { usePayment } from '@/hooks/usePayment'
import { useUsdcBalance, useWallet } from '@/hooks/useWallet'
import { feeForDisplay } from '@/lib/fees'
import { fmtDate, fmtUsdc, shortAddress } from '@/lib/format'
import { parseRequest, requestDomain, requestTypes, type SignedRequest } from '@/lib/requests'
import { Link, navigate, pathFor } from '@/lib/router'
import { Amount, usdcToGasToken } from '@/onchain-money'
import { paynoraAbi } from '@/paynoraAbi'
import { CHAIN_ID, PAYNORA_ADDRESS, USDC_DECIMALS, configProblem } from '@/paynora'

function useRequestChecks(request: SignedRequest | undefined) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  return useQuery({
    queryKey: ['request-check', request?.payee, request?.requestId, request?.signature],
    enabled: Boolean(client && request && PAYNORA_ADDRESS),
    refetchInterval: 10_000,
    retry: 1,
    queryFn: async () => {
      if (!client || !request || !PAYNORA_ADDRESS) throw new Error('not ready')
      const [open, validSignature, block] = await Promise.all([
        client.readContract({ address: PAYNORA_ADDRESS, abi: paynoraAbi, functionName: 'isRequestOpen', args: [request.payee, request.requestId] }),
        client
          .verifyTypedData({
            address: request.payee,
            domain: requestDomain(PAYNORA_ADDRESS),
            types: requestTypes,
            primaryType: 'PaymentRequest',
            message: { payee: request.payee, amount: request.amount, requestId: request.requestId, note: request.note, expiry: request.expiry },
            signature: request.signature,
          })
          .catch(() => false),
        client.getBlock(),
      ])
      return { open, validSignature, expired: block.timestamp > request.expiry }
    },
  })
}

function Check({ ok, pending, children }: { ok?: boolean; pending?: boolean; children: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {pending ? <Clock className="h-4 w-4 text-muted" aria-hidden /> : ok ? <BadgeCheck className="h-4 w-4 text-ok" aria-hidden /> : <CircleSlash className="h-4 w-4 text-bad" aria-hidden />}
      <span className={pending ? 'text-muted' : ok ? '' : 'text-bad'}>{children}</span>
    </li>
  )
}

function Pay({ request }: { request: SignedRequest }) {
  const { address, isConnected, isConnecting, wrongNetwork, switchToArc, isSwitching } = useWallet()
  const queryClient = useQueryClient()
  const checks = useRequestChecks(request)
  const balance = useUsdcBalance(address)
  const payment = usePayment()
  const connectWallet = useConnectWallet()
  const [started, setStarted] = useState(false)
  const job = useMemo(() => ({ to: request.payee, amount: request.amount, note: request.note, request }), [request])
  const payable = Boolean(checks.data?.open && checks.data.validSignature && !checks.data.expired)
  const own = address?.toLowerCase() === request.payee.toLowerCase()
  const fee = useFeeEstimate(isConnected && !wrongNetwork && payable && !own && !started ? job : undefined)

  const confirmed = payment.entry?.status === 'confirmed'
  useEffect(() => {
    if (confirmed) void queryClient.invalidateQueries()
  }, [confirmed, queryClient])

  const summary = (
    <Rows rows={[['Pay to', request.payee], ['Amount', `${fmtUsdc(request.amount)} USDC`], ...(request.note ? ([['Note', request.note]] as [string, string][]) : [])]} />
  )

  if (started) {
    return (
      <TxProgress
        payment={payment}
        summary={summary}
        onDone={() => {
          payment.reset()
          navigate(pathFor('activity'))
        }}
        onNew={() => navigate(pathFor('home'))}
        onEdit={() => {
          payment.reset()
          setStarted(false)
        }}
        onRetry={() => {
          payment.reset()
          void payment.run(job)
        }}
      />
    )
  }

  const shortfall =
    balance.data !== undefined && fee.data
      ? usdcToGasToken(CHAIN_ID, Amount.fromRaw(balance.data, USDC_DECIMALS)).lt(usdcToGasToken(CHAIN_ID, Amount.fromRaw(request.amount, USDC_DECIMALS)).add(fee.data.nextFee))
      : balance.data !== undefined && balance.data < request.amount

  return (
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Payment request</p>
      <p className="num mt-1 font-display text-[44px] font-bold leading-none tracking-[-0.04em]">
        {fmtUsdc(request.amount)} <span className="text-lg text-muted">USDC</span>
      </p>
      <p className="mt-2 text-[15px] text-muted">
        to <span className="num font-mono text-sm text-ink" title={request.payee}>{shortAddress(request.payee)}</span>
        {request.note && <> · {request.note}</>}
      </p>

      <ul className="mt-5 space-y-2 rounded-2xl bg-sunk/70 p-4" aria-label="Request checks">
        {checks.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : checks.isError || !checks.data ? (
          <li className="text-sm text-bad">Could not verify this request on Arc. Check your connection and refresh.</li>
        ) : (
          <>
            <Check ok={checks.data.validSignature}>{checks.data.validSignature ? 'Signed by the payee' : 'Signature does not match the payee'}</Check>
            <Check ok={checks.data.open}>{checks.data.open ? 'Not paid or cancelled yet' : 'Already paid or cancelled'}</Check>
            <Check ok={!checks.data.expired}>{checks.data.expired ? 'Expired' : `Valid until ${fmtDate(Number(request.expiry))}`}</Check>
          </>
        )}
      </ul>

      {payable && fee.data && (
        <p className="mt-4 text-[13px] text-muted">
          Network fee ≈ {feeForDisplay(fee.data.nextFee).toString()} USDC{fee.data.approvalNeeded ? ' (approval step; 2 wallet confirmations)' : ''}
        </p>
      )}
      {shortfall && payable && !own && <FieldError>Your USDC balance is too low for this request plus the network fee.</FieldError>}
      {fee.errorMessage && <FieldError>{fee.errorMessage}</FieldError>}

      <div className="mt-5">
        {own ? (
          <p className="text-sm text-muted">This is your own request. Share the link with the person who should pay.</p>
        ) : isConnecting ? (
          <Skeleton className="h-12 w-full" />
        ) : !isConnected ? (
          <Button block onClick={connectWallet.open} loading={connectWallet.isConnecting}>
            {connectWallet.testMode ? 'Connect test wallet to pay' : 'Connect wallet to pay'}
          </Button>
        ) : wrongNetwork ? (
          <Button block onClick={() => void switchToArc()} loading={isSwitching}>
            Switch to Arc Mainnet
          </Button>
        ) : (
          <Button
            block
            disabled={!payable || Boolean(shortfall) || !fee.data || payment.busy}
            loading={fee.isLoading}
            onClick={() => {
              setStarted(true)
              void payment.run(job)
            }}
          >
            Pay {fmtUsdc(request.amount)} USDC
          </Button>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted">Only a verified onchain transaction counts as payment.</p>
    </Card>
  )
}

export function OpenRequestView({ search }: { search: URLSearchParams }) {
  const key = search.toString()
  const parsed = useMemo(() => parseRequest(new URLSearchParams(key)), [key])
  return (
    <>
      <PageTitle title="Pay a request" />
      {configProblem ? (
        <ConfigCard />
      ) : parsed.ok ? (
        <Pay request={parsed.request} />
      ) : (
        <Card>
          <EmptyState
            icon={<LinkIcon className="h-6 w-6" aria-hidden />}
            title="This request link doesn't work"
            action={
              <Link to={pathFor('home')} className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-5 text-[15px] font-semibold text-brand-ink">
                Go to Paynora
              </Link>
            }
          >
            {parsed.reason} Ask the sender for a new link.
          </EmptyState>
        </Card>
      )}
    </>
  )
}
