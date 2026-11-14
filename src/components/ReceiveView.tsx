import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ExternalLink, HandCoins, Share2 } from 'lucide-react'
import { AmountField } from '@/components/AmountField'
import { ConnectCard } from '@/components/Gate'
import { Button, Card, CopyButton, Label, PageTitle, Skeleton, inputClass } from '@/components/ui'
import { useWallet } from '@/hooks/useWallet'
import { byteLength } from '@/lib/format'
import { Link, pathFor } from '@/lib/router'
import { getShareBase } from '@/lib/share'
import { parseAmount } from '@/onchain-money'
import { addressUrl, CHAIN_ID, MAX_NOTE_BYTES, NETWORK_NAME } from '@/paynora'
import type { Address } from 'viem'

/** An unsigned, shareable link that opens Pay with the recipient (and optionally amount and note) filled in. */
function PaymentLink({ address }: { address: Address }) {
  const [base, setBase] = useState<string>()
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    void getShareBase().then((b) => {
      if (alive) setBase(b)
    })
    return () => {
      alive = false
    }
  }, [])

  const amountValid = useMemo(() => {
    if (!amountText || amountText === '.') return true
    try {
      return parseAmount(CHAIN_ID, amountText).isPositive()
    } catch {
      return false
    }
  }, [amountText])
  const noteValid = byteLength(note) <= MAX_NOTE_BYTES

  const link = useMemo(() => {
    if (!base || !amountValid || !noteValid) return undefined
    const q = new URLSearchParams({ to: address })
    if (amountText && amountText !== '.') q.set('amt', amountText)
    if (note.trim()) q.set('memo', note.trim())
    return `${base}/pay?${q.toString()}`
  }, [base, address, amountText, note, amountValid, noteValid])

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share = async () => {
    if (!link) return
    try {
      await navigator.share({ title: 'Pay me with Paynora', url: link })
    } catch {
      // Cancelled or unsupported: copying remains available.
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="text-lg font-semibold">Payment link</h2>
      <p className="mt-1 text-[13px] text-muted">A link that opens Pay with your address filled in. It is not a signed request: the sender still reviews and confirms everything in their wallet.</p>
      <div className="mt-4 space-y-4">
        <AmountField value={amountText} onChange={setAmountText} error={amountValid ? undefined : 'Use a positive amount with at most 6 decimals.'} hint="Optional. Leave empty to let the sender choose." />
        <div>
          <Label htmlFor="link-note">Note (optional)</Label>
          <input id="link-note" className={inputClass} maxLength={200} placeholder="What is this for?" value={note} onChange={(e) => setNote(e.target.value)} />
          {!noteValid && <p className="mt-1.5 text-[13px] text-bad">Notes are limited to {MAX_NOTE_BYTES} bytes.</p>}
        </div>
        <p className="num break-all rounded-2xl bg-sunk/70 p-3 font-mono text-xs text-muted" aria-label="Payment link">
          {link ?? (base ? 'Fix the fields above to build the link.' : 'Preparing link…')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyButton value={link ?? ''} label="Copy link" disabled={!link} className="w-full" />
          <Button onClick={() => void share()} disabled={!link || !canShare}>
            <Share2 className="h-4 w-4" aria-hidden /> {canShare ? 'Share' : 'Share unavailable'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

export function ReceiveView() {
  const { address, isConnected, isConnecting } = useWallet()
  const explorer = address ? addressUrl(address) : undefined
  return (
    <>
      <PageTitle title="Receive" subtitle={`Your address on ${NETWORK_NAME}. Only send USDC on Arc to it.`} />
      {isConnecting ? (
        <Skeleton className="h-96 w-full rounded-3xl" />
      ) : !isConnected || !address ? (
        <ConnectCard message="Connect a wallet to show your receiving address." />
      ) : (
        <>
          <Card>
            <div className="flex flex-col items-center text-center">
              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <QRCodeSVG value={address} size={208} level="M" fgColor="#0E1A2B" bgColor="#FFFFFF" />
              </div>
              <p className="num mt-5 break-all font-mono text-sm leading-relaxed">{address}</p>
              <p className="mt-2 max-w-xs text-[13px] text-muted">This is the wallet you are connected with. Anyone can send USDC to it from any app that supports Arc.</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <CopyButton value={address} label="Copy address" className="w-full" />
              <Link
                to={pathFor('request')}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-[15px] font-semibold text-brand-ink transition hover:opacity-90"
              >
                <HandCoins className="h-4 w-4" aria-hidden /> Share payment request
              </Link>
            </div>
            {explorer && (
              <a href={explorer} target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center justify-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
                View on Arc Explorer <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </Card>
          <PaymentLink address={address} />
        </>
      )}
    </>
  )
}
