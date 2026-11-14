import { Compass } from 'lucide-react'
import { ActivityProvider } from '@/hooks/ActivityProvider'
import { ActivityView } from '@/components/ActivityView'
import { Dashboard } from '@/components/Dashboard'
import { OpenRequestView } from '@/components/OpenRequestView'
import { PayView } from '@/components/PayView'
import { ReceiveView } from '@/components/ReceiveView'
import { RequestView } from '@/components/RequestView'
import { Shell } from '@/components/Shell'
import { Card, EmptyState } from '@/components/ui'
import { Link, pathFor, useRoute } from '@/lib/router'

function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<Compass className="h-6 w-6" aria-hidden />}
        title="Page not found"
        action={
          <Link to={pathFor('home')} className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-5 text-[15px] font-semibold text-brand-ink">
            Back to Paynora
          </Link>
        }
      >
        That page does not exist.
      </EmptyState>
    </Card>
  )
}

function Routes() {
  const { route, search } = useRoute()
  switch (route) {
    case 'home':
      return <Dashboard />
    case 'pay':
      return <PayView search={search} />
    case 'request':
      return <RequestView />
    case 'receive':
      return <ReceiveView />
    case 'activity':
      return <ActivityView />
    case 'open':
      return <OpenRequestView search={search} />
    default:
      return <NotFound />
  }
}

export default function App() {
  return (
    <ActivityProvider>
      <Shell>
        <Routes />
      </Shell>
    </ActivityProvider>
  )
}
