import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { shortHash } from '@/lib/format'
import { txUrl } from '@/paynora'

/** Arc Explorer link for a transaction. The local test chain has no explorer, so it shows the hash instead. */
export function ExplorerLink({ hash, children, className }: { hash: string; children: ReactNode; className?: string }) {
  const url = txUrl(hash)
  if (!url) {
    return (
      <span className={className} title={hash}>
        <span className="num font-mono text-[0.92em]">{shortHash(hash)}</span> <span className="text-muted">(test chain, no explorer)</span>
      </span>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children} <ExternalLink className="inline h-3.5 w-3.5" aria-hidden />
    </a>
  )
}
