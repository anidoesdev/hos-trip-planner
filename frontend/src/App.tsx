import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, ensureAwake, pingHealth, planTrip } from './api/client'
import type { TripPlan, TripRequest } from './api/types'
import { TripForm } from './components/form/TripForm'
import { EMPTY_DETAILS, type CarrierDetails } from './components/logs/DailyLogSheet'
import { LogSheetViewer } from './components/logs/LogSheetViewer'
import { EmptyState } from './components/results/EmptyState'
import { Itinerary } from './components/results/Itinerary'
import { ErrorState, PlanningProgress } from './components/results/States'
import { SummaryPanel } from './components/results/SummaryPanel'
import { Card, SectionHeading, cx } from './components/ui/primitives'
import { useLocalStorage } from './hooks/useLocalStorage'
import { buildStopItems, groupIdForStop, groupStops } from './lib/stops'

const RouteMap = lazy(() => import('./components/results/RouteMap'))

type ServerStatus = 'checking' | 'online' | 'waking' | 'offline'
type Phase = { name: 'idle' } | { name: 'waking'; elapsed: number } | { name: 'planning' } | { name: 'error'; error: ApiError } | { name: 'done' }

const SAMPLE_DETAILS: CarrierDetails = {
  ...EMPTY_DETAILS,
  carrier: 'Sample Freight Lines LLC',
  mainOffice: 'Chicago, IL',
  homeTerminal: 'Chicago, IL',
  truck: 'Tractor 1042 / Trailer 5580 (IL)',
  manifest: 'BOL-2026-00142',
  shipper: 'Sample Shipper — general freight',
}

function Header({ status }: { status: ServerStatus }) {
  const dot = { checking: 'bg-slate-400', online: 'bg-emerald-500', waking: 'bg-amber-500 animate-pulse', offline: 'bg-red-500' }[status]
  const text = { checking: 'Connecting…', online: 'Planner online', waking: 'Waking server…', offline: 'Server offline' }[status]
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur-sm print:hidden">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-7" width={28} height={28} />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            HOS Trip Planner
            <span className="ml-2 hidden font-normal text-muted sm:inline">Route · Rest stops · ELD daily logs</span>
          </span>
        </a>
        <span className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
          <span className={cx('size-2 rounded-full', dot)} aria-hidden />
          <span className="hidden sm:inline">{text}</span>
        </span>
      </div>
    </header>
  )
}

/** Jump links for the long results page; stays pinned while scrolling. */
function SectionNav({ days }: { days: number }) {
  const links = [
    { href: '#summary', label: 'Summary' },
    { href: '#route', label: 'Map & stops' },
    { href: '#logs', label: `Daily logs (${days})` },
  ]
  return (
    <nav
      aria-label="Results sections"
      className="sticky top-0 z-[1000] -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface/90 p-1 shadow-card backdrop-blur-md"
    >
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-paper hover:text-ink"
        >
          {l.label}
        </a>
      ))}
    </nav>
  )
}

export default function App() {
  const [status, setStatus] = useState<ServerStatus>('checking')
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [lastRequest, setLastRequest] = useState<TripRequest | null>(null)
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [details, setDetails] = useLocalStorage<CarrierDetails>('hos.carrierDetails', SAMPLE_DETAILS)
  const abortRef = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Warm the backend as soon as the page opens, so a cold start overlaps with typing.
  useEffect(() => {
    const ctrl = new AbortController()
    pingHealth(ctrl.signal).then((ok) => {
      if (ok) return setStatus('online')
      setStatus('waking')
      ensureAwake(() => undefined, ctrl.signal)
        .then(() => setStatus('online'))
        .catch(() => !ctrl.signal.aborted && setStatus('offline'))
    })
    return () => ctrl.abort()
  }, [])

  const run = useCallback(async (req: TripRequest) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLastRequest(req)
    setPhase({ name: 'planning' })
    try {
      await ensureAwake((elapsed) => {
        setStatus('waking')
        setPhase({ name: 'waking', elapsed })
      }, ctrl.signal)
      setStatus('online')
      setPhase({ name: 'planning' })
      const result = await planTrip(req, ctrl.signal)
      if (ctrl.signal.aborted) return
      setPlan(result)
      setSelectedStopId(null)
      setSelectedGroupId(null)
      setPhase({ name: 'done' })
      if (window.matchMedia('(max-width: 1023px)').matches) {
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      }
    } catch (e) {
      if (ctrl.signal.aborted) return
      const err = e instanceof ApiError ? e : new ApiError('unknown', 'Unexpected error. Please retry.')
      if (err.code === 'server_unreachable') setStatus('offline')
      setPhase({ name: 'error', error: err })
    }
  }, [])

  const items = useMemo(() => (plan ? buildStopItems(plan) : []), [plan])
  const groups = useMemo(() => (plan ? groupStops(plan, items) : []), [plan, items])

  const serverErrors = useMemo(() => {
    if (phase.name !== 'error') return undefined
    const { error } = phase
    if (error.field) return { [error.field]: error.message }
    if (error.fields) return Object.fromEntries(Object.entries(error.fields).map(([k, v]) => [k, v.join(' ')]))
    return undefined
  }, [phase])

  const selectStop = (stopId: string | null, groupId?: string) => {
    setSelectedStopId(stopId)
    setSelectedGroupId(groupId ?? (stopId ? (groupIdForStop(groups, stopId) ?? null) : null))
  }

  const busy = phase.name === 'planning' || phase.name === 'waking'

  return (
    <div className="min-h-dvh">
      <Header status={status} />
      <main className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:py-8 print:hidden">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <TripForm busy={busy} onSubmit={run} serverErrors={serverErrors} />
        </aside>

        <div ref={resultsRef} className="min-w-0 scroll-mt-4 space-y-6">
          {phase.name === 'error' && (
            <ErrorState error={phase.error} onRetry={() => lastRequest && run(lastRequest)} />
          )}
          {busy && <PlanningProgress waking={phase.name === 'waking'} wakeElapsedMs={phase.name === 'waking' ? phase.elapsed : 0} />}
          {!plan && !busy && phase.name !== 'error' && <EmptyState />}

          {plan && (
            <div className={cx('space-y-6 transition-opacity', busy && 'pointer-events-none opacity-50')}>
              <SectionNav days={plan.daily_logs.length} />

              <div id="summary" className="scroll-mt-16">
                <SummaryPanel plan={plan} />
              </div>

              <section id="route" aria-labelledby="route-heading" className="scroll-mt-16 space-y-4">
                <SectionHeading
                  eyebrow="Route"
                  title={<span id="route-heading">Map &amp; stops</span>}
                  description="Every required stop in order. Click a stop to see it on the map."
                />
                <Card className="grid overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="h-[440px] p-2 sm:h-[460px] xl:h-[560px]">
                    <Suspense fallback={<div className="h-full w-full animate-pulse rounded-xl bg-line/60" />}>
                      <RouteMap
                        plan={plan}
                        groups={groups}
                        selectedGroupId={selectedGroupId}
                        onSelectGroup={(id) => {
                          setSelectedGroupId(id)
                          setSelectedStopId(null)
                        }}
                      />
                    </Suspense>
                  </div>
                  <div className="max-h-[520px] overflow-y-auto border-t border-line px-3 py-4 xl:max-h-[560px] xl:border-l xl:border-t-0">
                    <Itinerary plan={plan} items={items} selectedStopId={selectedStopId} onSelectStop={selectStop} />
                  </div>
                </Card>
              </section>

              <div id="logs" className="scroll-mt-16">
                <LogSheetViewer plan={plan} details={details} onDetailsChange={setDetails} />
              </div>
            </div>
          )}
        </div>
      </main>
      <footer className="mx-auto max-w-[1440px] px-4 pb-8 text-xs text-muted sm:px-6 print:hidden">
        Rules: 49 CFR Part 395 (property carrier, 70 hr / 8 day). Map data © OpenStreetMap contributors. Planning
        aid only — not a substitute for a certified ELD.
      </footer>
    </div>
  )
}
