import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

export type RouteName = 'home' | 'pay' | 'request' | 'receive' | 'activity' | 'open' | 'notfound'

const PATHS: Record<Exclude<RouteName, 'notfound'>, string> = {
  home: '/',
  pay: '/pay',
  request: '/request',
  receive: '/receive',
  activity: '/activity',
  open: '/r',
}

const NAV_EVENT = 'paynora:navigate'

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  window.addEventListener(NAV_EVENT, callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener(NAV_EVENT, callback)
  }
}

const snapshot = () => window.location.pathname + window.location.search

export function navigate(to: string) {
  if (to === snapshot()) return
  window.history.pushState({}, '', to)
  window.dispatchEvent(new Event(NAV_EVENT))
  window.scrollTo({ top: 0 })
}

export function useRoute(): { route: RouteName; search: URLSearchParams } {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [path, query = ''] = current.split('?')
  const clean = path.replace(/\/+$/, '') || '/'
  const match = (Object.entries(PATHS) as [Exclude<RouteName, 'notfound'>, string][]).find(([, p]) => p === clean)
  return { route: match ? match[0] : 'notfound', search: new URLSearchParams(query) }
}

export const pathFor = (route: Exclude<RouteName, 'notfound'>) => PATHS[route]

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  children: ReactNode
}

/** In-app link: client-side navigation, but still a real anchor for keyboard and middle-click. */
export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
