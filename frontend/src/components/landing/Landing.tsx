import type { CSSProperties } from 'react'
import { ArrowRight, CheckCircle2, ClipboardList, Gauge, MapPinned, Play, Route, ShieldCheck, Timer } from 'lucide-react'
import { Button, Card } from '../ui/primitives'

interface Props {
  onStart: () => void
  onExample: () => void
}

/* ---- animated preview ------------------------------------------------------------------------ */
// one 7 s loop: the route draws (0-55%), stops pop in as the line reaches them, the view holds, then resets
const LOOP_S = 7
const DRAW_END = 0.55
const ROUTE = [
  [24, 50], [72, 40], [118, 72], [162, 62], [206, 108], [252, 116], [298, 158],
] as const
const ROUTE_D = ROUTE.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
const STOPS: { at: number; color: string }[] = [
  { at: 1, color: 'var(--color-stop-break)' },
  { at: 2, color: 'var(--color-stop-reset)' },
  { at: 3, color: 'var(--color-stop-fuel)' },
  { at: 4, color: 'var(--color-stop-reset)' },
  { at: 5, color: 'var(--color-stop-restart)' },
]
const delayFor = (vertex: number) => `${((vertex / (ROUTE.length - 1)) * DRAW_END * LOOP_S).toFixed(2)}s`
// a day on the log: off, on (pre-trip), driving, break, driving, sleeper
const LOG_D = 'M0 6H60V30H64V22H132V6H138V22H174V14H240'

function MiniGauge({ label, value, p, color }: { label: string; value: string; p: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90 overflow-visible" aria-hidden>
        <circle cx="18" cy="18" r="14" fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          pathLength={1}
          className="gauge-arc pv-gauge"
          style={{ color, '--p': p } as CSSProperties}
        />
      </svg>
      <div className="leading-tight">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="num text-[11px] font-bold text-ink">{value}</p>
      </div>
    </div>
  )
}

function PreviewScreen() {
  return (
    <div className="relative mx-auto max-w-4xl">
      {/* soft glow behind the window */}
      <div
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] opacity-70 blur-2xl"
        style={{ background: 'radial-gradient(60% 60% at 30% 30%, color-mix(in srgb, var(--color-accent) 28%, transparent), transparent 70%), radial-gradient(60% 60% at 80% 70%, color-mix(in srgb, var(--color-gauge) 28%, transparent), transparent 70%)' }}
        aria-hidden
      />
      <Card className="overflow-hidden text-left">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-line bg-paper/70 px-4 py-2.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#fb7185]" />
          <span className="size-2.5 rounded-full bg-[#fbbf24]" />
          <span className="size-2.5 rounded-full bg-[#34d399]" />
          <span className="num ml-3 truncate rounded-md bg-surface px-2.5 py-0.5 text-[10.5px] text-muted ring-1 ring-line">
            hos-trip-planner / Chicago → Dallas → Los Angeles
          </span>
        </div>

        <div className="grid gap-3 p-3 sm:grid-cols-[1.35fr_1fr] sm:p-4" role="img" aria-label="Preview: a route with rest stops on a map, HOS gauges, and a daily log line">
          {/* map */}
          <div className="relative overflow-hidden rounded-xl bg-desk ring-1 ring-line">
            <svg viewBox="0 0 320 200" className="h-full w-full" aria-hidden>
              {Array.from({ length: 9 }, (_, i) => (
                <line key={`v${i}`} x1={i * 40} x2={i * 40} y1={0} y2={200} stroke="var(--color-line)" strokeWidth="0.6" />
              ))}
              {Array.from({ length: 6 }, (_, i) => (
                <line key={`h${i}`} x1={0} x2={320} y1={i * 40} y2={i * 40} stroke="var(--color-line)" strokeWidth="0.6" />
              ))}
              <path d="M0 120 C60 100 90 140 150 128 S250 150 320 136" fill="none" stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="3 4" />
              <path d={ROUTE_D} fill="none" stroke="var(--color-surface)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
              <path d={ROUTE_D} fill="none" stroke="var(--color-gauge)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="pv-draw" />
              {STOPS.map((s) => {
                const [x, y] = ROUTE[s.at]
                return (
                  <circle key={s.at} cx={x} cy={y} r="6.5" fill={s.color} stroke="#fff" strokeWidth="2" className="pv-pop" style={{ animationDelay: delayFor(s.at) }} />
                )
              })}
              <circle cx={ROUTE[0][0]} cy={ROUTE[0][1]} r="7" fill="var(--color-stop-start)" stroke="#fff" strokeWidth="2" />
              <circle cx={ROUTE[6][0]} cy={ROUTE[6][1]} r="7.5" fill="var(--color-stop-dropoff)" stroke="#fff" strokeWidth="2" className="pv-pop" style={{ animationDelay: delayFor(6) }} />
              <g className="pv-truck" style={{ offsetPath: `path('${ROUTE_D}')` } as CSSProperties}>
                <rect x="-7" y="-7" width="14" height="14" rx="4" fill="var(--color-truck)" stroke="#fff" strokeWidth="2" />
              </g>
            </svg>
          </div>

          {/* instruments + log */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-paper/60 p-2.5 ring-1 ring-line">
              <MiniGauge label="Driving" value="11h/11h" p={1} color="var(--color-gauge-limit)" />
              <MiniGauge label="Window" value="12h/14h" p={0.86} color="var(--color-gauge-warn)" />
              <MiniGauge label="Cycle" value="31h/70h" p={0.45} color="var(--color-gauge)" />
            </div>
            <div className="rounded-xl bg-white p-2.5 ring-1 ring-line">
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-[#111]">Driver&apos;s daily log · Day 1</p>
              <svg viewBox="-2 0 244 36" className="w-full" aria-hidden>
                {[0, 1, 2, 3].map((r) => (
                  <rect key={r} x="0" y={r * 8 + 2} width="240" height="8" fill="none" stroke="#111" strokeWidth="0.5" />
                ))}
                {Array.from({ length: 25 }, (_, i) => (
                  <line key={i} x1={i * 10} x2={i * 10} y1="2" y2="34" stroke="#111" strokeWidth="0.3" />
                ))}
                <path d={LOG_D} fill="none" stroke="#1e3a8a" strokeWidth="1.8" strokeLinejoin="round" pathLength={1} className="pv-draw" style={{ animationDelay: '0.3s' }} />
              </svg>
            </div>
            {/* upcoming stops (fills the column beside the taller map; hidden on phones) */}
            <ul className="hidden flex-1 space-y-1.5 rounded-xl bg-paper/60 p-2.5 ring-1 ring-line sm:block">
              <li className="text-[9px] font-semibold uppercase tracking-wide text-muted">Upcoming stops</li>
              {[
                { color: 'var(--color-stop-break)', title: '30-min break', where: 'Pulaski, IL', time: '2:15 PM' },
                { color: 'var(--color-stop-reset)', title: '10-hr rest', where: 'Norden, AR', time: '5:45 PM' },
                { color: 'var(--color-stop-fuel)', title: 'Fuel stop', where: 'Mount Pleasant, TX', time: '11:45 AM' },
              ].map((s, i) => (
                <li key={s.title} className="pv-pop flex items-center gap-2" style={{ animationDelay: delayFor(i + 1), transformOrigin: 'left center' }}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                    <span className="font-semibold">{s.title}</span> <span className="text-muted">· {s.where}</span>
                  </span>
                  <span className="num shrink-0 text-[10px] text-ink-soft">{s.time}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[10.5px] font-medium text-ok">
                <CheckCircle2 className="size-3" aria-hidden /> HOS compliant
              </span>
              <span className="num rounded-full bg-paper px-2 py-0.5 text-[10.5px] text-ink-soft ring-1 ring-line">2,407 mi</span>
              <span className="num rounded-full bg-paper px-2 py-0.5 text-[10.5px] text-ink-soft ring-1 ring-line">6 log sheets</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

/* ---- page -------------------------------------------------------------------------------------- */
const STEPS = [
  { icon: MapPinned, title: 'Enter the trip', text: 'Where the truck is, the pickup, the drop-off, and the hours already used in the 70-hour cycle.' },
  { icon: ShieldCheck, title: 'HOS rules are applied', text: 'A minute-by-minute simulation places every break, 10-hr rest, 34-hr restart and fuel stop exactly where the rules require.' },
  { icon: ClipboardList, title: 'Get the route and logs', text: 'A map of every stop, a playback of the HOS clocks, and a filled-in Driver’s Daily Log for each day.' },
]

const RULES = [
  { icon: Timer, text: '11-hr driving limit' },
  { icon: Gauge, text: '14-hr duty window' },
  { icon: Timer, text: '30-min break after 8 hr' },
  { icon: Gauge, text: '70-hr / 8-day cycle' },
  { icon: Route, text: 'Fuel every 1,000 mi' },
]

export function Landing({ onStart, onExample }: Props) {
  // overflow-x-clip: the preview glow bleeds past the edges without making the page scroll sideways
  return (
    <div className="animate-rise space-y-16 overflow-x-clip pb-8 pt-6 sm:space-y-20 sm:pt-12">
      {/* hero */}
      <section className="mx-auto max-w-3xl text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/70 px-3 py-1 text-xs font-medium text-ink-soft">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden />
          ELD trip planner · FMCSA Hours of Service
        </p>
        <h1 className="mt-5 text-[34px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[52px]">
          Plan a compliant truck trip <span className="text-accent-strong">in seconds</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-lg">
          Enter the trip. The planner routes the truck, places every required break, rest and fuel stop,
          and fills in the Driver’s Daily Log for each day.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button variant="primary" size="lg" onClick={onStart} className="w-full px-8 sm:w-auto" icon={<Route className="size-4" aria-hidden />}>
            Plan a trip
            <ArrowRight className="size-4" aria-hidden />
          </Button>
          <Button size="lg" onClick={onExample} className="w-full sm:w-auto" icon={<Play className="size-4" aria-hidden />}>
            See an example
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">No sign-up · Free map data · Property carrier, 70 hr / 8 day</p>
      </section>

      <PreviewScreen />

      {/* how it works */}
      <section aria-labelledby="how-heading" className="mx-auto max-w-5xl">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-strong">How it works</p>
        <h2 id="how-heading" className="mt-1 text-center text-2xl font-semibold tracking-tight text-ink">
          Three steps from trip to logbook
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-3">
                  <span className="num flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary">{i + 1}</span>
                  <Icon className="size-5 text-accent-strong" aria-hidden />
                </div>
                <p className="mt-3 font-semibold text-ink">{title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* rules strip */}
      <section aria-label="Rules applied" className="mx-auto max-w-4xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Checked on every plan (49 CFR §395.3)</p>
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {RULES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[13px] text-ink-soft">
              <Icon className="size-3.5 text-accent-strong" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </section>

      {/* closing call to action */}
      <section className="mx-auto max-w-xl text-center">
        <p className="text-lg font-semibold text-ink">Ready to plan your next run?</p>
        <Button variant="primary" size="lg" onClick={onStart} className="mt-4 px-8">
          Start planning
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </section>
    </div>
  )
}
