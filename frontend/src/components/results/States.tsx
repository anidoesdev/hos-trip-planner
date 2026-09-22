import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CloudOff, Loader2, MapPinOff, RotateCcw, ServerCrash } from 'lucide-react'
import { ApiError } from '../../api/client'
import { Button, Card, cx } from '../ui/primitives'

const STEPS = [
  { label: 'Geocoding locations', at: 0 },
  { label: 'Routing the truck', at: 1200 },
  { label: 'Applying HOS rules', at: 3000 },
  { label: 'Labeling stops & drawing logs', at: 5000 },
]

export function PlanningProgress({ waking, wakeElapsedMs }: { waking: boolean; wakeElapsedMs: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (waking) return
    const started = Date.now()
    const t = setInterval(() => setElapsed(Date.now() - started), 200)
    return () => clearInterval(t)
  }, [waking])
  const current = waking ? -1 : STEPS.filter((s) => elapsed >= s.at).length - 1

  return (
    <Card className="p-6 sm:p-8" aria-live="polite" aria-busy>
      <div className="relative mb-6 h-1 overflow-hidden rounded-full bg-line">
        <div className="animate-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-accent" />
      </div>
      {waking ? (
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-accent" aria-hidden />
          <div>
            <p className="font-medium text-ink">Waking up the planning server…</p>
            <p className="mt-1 text-sm text-muted">
              The free-tier backend sleeps when idle and takes up to a minute to start.
              {wakeElapsedMs > 4000 && ` Waiting ${Math.round(wakeElapsedMs / 1000)} s…`}
            </p>
          </div>
        </div>
      ) : (
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.label} className="flex items-center gap-3">
              <span
                className={cx(
                  'flex size-6 items-center justify-center rounded-full text-xs',
                  i < current && 'bg-ok text-white',
                  i === current && 'bg-accent-soft text-accent-strong',
                  i > current && 'bg-line text-muted',
                )}
              >
                {i < current ? (
                  <Check className="size-3.5" aria-hidden />
                ) : i === current ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <span className={cx('text-sm', i <= current ? 'font-medium text-ink' : 'text-muted')}>
                {s.label}
                {i === current && '…'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const Icon =
    error.code === 'location_not_found'
      ? MapPinOff
      : error.code === 'server_unreachable' || error.code === 'network'
        ? CloudOff
        : error.status >= 500
          ? ServerCrash
          : AlertTriangle
  const title =
    error.code === 'location_not_found'
      ? "We couldn't find one of those places"
      : error.code === 'route_not_found'
        ? 'No drivable route between these points'
        : error.code === 'validation_error'
          ? 'Please check the highlighted fields'
          : error.code === 'server_unreachable' || error.code === 'network'
            ? 'Planning server unavailable'
            : 'Something went wrong while planning'
  return (
    <Card className="p-6 sm:p-8" role="alert">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm text-muted">{error.message}</p>
          {error.code === 'location_not_found' && (
            <p className="mt-1 text-sm text-muted">Try a nearby city with its state, e.g. “Joliet, IL”.</p>
          )}
          {error.retryable && (
            <Button className="mt-4" icon={<RotateCcw className="size-4" aria-hidden />} onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
