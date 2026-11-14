export type TxErrorKind = 'rejected' | 'insufficient' | 'rpc' | 'reverted' | 'wrong-chain' | 'unknown'

export interface TxError {
  kind: TxErrorKind
  message: string
}

const REVERT_MESSAGES: Record<string, string> = {
  InvalidRecipient: 'That recipient address is not allowed.',
  InvalidAmount: 'The amount must be greater than zero.',
  NoteTooLong: 'The note is too long.',
  InvalidRequestId: 'This payment request is malformed.',
  RequestExpired: 'This payment request has expired.',
  RequestClosed: 'This payment request was already paid or cancelled.',
  InvalidSignature: 'The request signature is not valid.',
  SelfPayment: 'You cannot pay your own address.',
  ERC20InsufficientBalance: 'Your USDC balance is too low for this payment.',
  ERC20InsufficientAllowance: 'USDC spending approval is missing or too small.',
  SafeERC20FailedOperation: 'The USDC transfer was refused by the token.',
}

interface ErrorLike {
  name?: unknown
  code?: unknown
  message?: unknown
  shortMessage?: unknown
  cause?: unknown
  data?: { errorName?: unknown }
}

function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = []
  let current: unknown = error
  while (current && typeof current === 'object' && out.length < 8) {
    out.push(current)
    current = (current as ErrorLike).cause
  }
  return out
}

/** Turns any wallet, RPC or contract failure into a short message the user can act on. */
export function classifyError(error: unknown): TxError {
  const links = chain(error)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const text = links.map((e) => `${str(e.name)} ${str(e.shortMessage) || str(e.message)}`).join(' ').toLowerCase()

  if (links.some((e) => e.code === 4001 || e.code === 'ACTION_REJECTED') || /user rejected|user denied|rejected the request/.test(text)) {
    return { kind: 'rejected', message: 'You rejected the request in your wallet. Nothing was sent.' }
  }
  for (const link of links) {
    const name = link.data?.errorName
    if (typeof name === 'string' && REVERT_MESSAGES[name]) return { kind: 'reverted', message: REVERT_MESSAGES[name] }
  }
  if (/insufficient funds|exceeds balance|insufficientfunds/.test(text)) {
    return { kind: 'insufficient', message: 'Not enough USDC to cover the amount plus the network fee.' }
  }
  if (/chain mismatch|chainmismatch|wrong chain|does not match the target chain/.test(text)) {
    return { kind: 'wrong-chain', message: 'Your wallet is on a different network. Switch to Arc Mainnet and try again.' }
  }
  if (/rate limit|429|timeout|timed out|network|fetch failed|http request failed|failed to fetch|unreachable/.test(text)) {
    return { kind: 'rpc', message: 'The Arc RPC did not respond. Check your connection and try again.' }
  }
  if (/revert/.test(text)) {
    return { kind: 'reverted', message: 'The contract rejected this payment. Nothing was sent.' }
  }
  return { kind: 'unknown', message: 'Something went wrong. Nothing was sent. Please try again.' }
}
