import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { DutyStatus, TripPlan } from '../../api/types'
import { KIND_LABEL } from '../../lib/explain'
import { fmtDuration, parseLocal } from '../../lib/format'
import { LIMITS, tripBounds, type Clocks } from '../../lib/hosClock'
import { Card, cx } from '../ui/primitives'

export const STATUS_COLOR: Record<DutyStatus, string> = {
  D: 'var(--color-status-d)',
  ON: 'var(--color-status-on)',
  SB: 'var(--color-status-sb)',
  OFF: 'var(--color-status-off)',
}
const STATUS_NAME: Record<DutyStatus, string> = { D: 'Driving', ON: 'On duty', SB: 'Sleeper berth', OFF: 'Off duty' }
const PLAY_SECONDS = 24 // a whole trip plays back in this many seconds

interface Props {
  plan: TripPlan
  playhead: number
  clocks: Clocks
  onChange: (t: number) => void
}

function Gauge({ label, used, limit, idle }: { label: string; used: number; limit: number; idle?: string }) {
  // a clock can run past its limit while resting (e.g. the 14-hr window); show it as "at limit"
  used = Math.min(used, limit)
  const pct = idle ? 0 : used / limit
  const tone = idle
    ? 'var(--color-line-strong)'
    : pct >= 0.999
      ? 'var(--color-gauge-limit)'
      : pct >= 0.85
        ? 'var(--color-gauge-warn)'
        : 'var(--color-gauge)'
  const r = 19
  const c = 2 * Math.PI * r
  const left = Math.max(0, limit - used)
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 48 48" className="size-12 shrink-0 -rotate-90 overflow-visible" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="currentColor"
          className="gauge-arc"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ color: tone, transition: 'stroke-dashoffset 120ms linear, color 200ms' }}
        />
      </svg>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
        <p className="num text-sm font-bold text-ink">
          {idle ?? fmtDuration(used / 60)}
          <span className="font-normal text-muted"> / {fmtDuration(limit / 60)}</span>
        </p>
        <p className={cx('tabular text-[11px]', pct >= 0.999 ? 'font-medium text-danger' : 'text-muted')}>
          {idle ? 'clock not running' : pct >= 0.999 ? 'limit reached' : `${fmtDuration(left / 60)} left`}
        </p>
      </div>
    </div>
  )
}

export function TripPlayback({ plan, playhead, clocks, onChange }: Props) {
  const { start, end } = useMemo(() => tripBounds(plan), [plan])
  const span = end - start || 1
  const [playing, setPlaying] = useState(false)
  const raf = useRef(0)
  const head = useRef(playhead)
  head.current = playhead

  // status strip segments and midnight ticks, as % of the trip
  const segments = useMemo(
    () =>
      plan.events
        .filter((e) => e.kind !== 'off_duty')
        .map((e) => {
          const a = Math.max(start, parseLocal(e.start).getTime())
          const b = Math.min(end, parseLocal(e.end).getTime())
          return { status: e.status, left: ((a - start) / span) * 100, width: ((b - a) / span) * 100 }
        }),
    [plan, start, end, span],
  )
  const midnights = useMemo(
    () =>
      plan.daily_logs.slice(1).map((d) => ({
        label: `Day ${d.day_number}`,
        left: ((parseLocal(d.date).getTime() - start) / span) * 100,
      })),
    [plan, start, span],
  )

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const tick = (now: number) => {
      const next = head.current + ((now - last) / 1000) * (span / PLAY_SECONDS)
      last = now
      if (next >= end) {
        onChange(end)
        setPlaying(false)
        return
      }
      onChange(next)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, span, end, onChange])

  const togglePlay = () => {
    if (!playing && playhead >= end) onChange(start)
    setPlaying((p) => !p)
  }

  const ev = clocks.event
  const when = new Date(playhead)
  const whenText = when.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const doing = ev.kind === 'drive' || ev.kind === 'off_duty' ? STATUS_NAME[ev.status] : KIND_LABEL[ev.kind]

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Trip playback</p>
        <p className="text-xs text-muted">Drag or press play to watch the HOS clocks run.</p>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause playback' : playhead >= end ? 'Replay trip' : 'Play trip'}
          className="glow flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm transition-colors hover:bg-primary-hover"
        >
          {playing ? (
            <Pause className="size-4" aria-hidden />
          ) : playhead >= end ? (
            <RotateCcw className="size-4" aria-hidden />
          ) : (
            <Play className="ml-0.5 size-4" aria-hidden />
          )}
        </button>

        <div className="relative min-w-0 flex-1 pb-4">
          <div className="relative h-3 overflow-hidden rounded-full bg-paper ring-1 ring-line" aria-hidden>
            {segments.map((s, i) => (
              <span
                key={i}
                className="absolute inset-y-0"
                style={{ left: `${s.left}%`, width: `${Math.max(s.width, 0.15)}%`, background: STATUS_COLOR[s.status] }}
              />
            ))}
          </div>
          {midnights.map((m) => (
            <span
              key={m.label}
              // ticks near the right edge align right so their label never wraps or overflows
              className={cx('absolute top-3.5 whitespace-nowrap text-[10px] text-muted', m.left > 90 ? '-translate-x-full text-right' : '-translate-x-1/2')}
              style={{ left: `${m.left}%` }}
              aria-hidden
            >
              <span className={cx('mb-0.5 block h-1.5 w-px bg-line-strong', m.left > 90 ? 'ml-auto' : 'mx-auto')} />
              {m.label}
            </span>
          ))}
          <input
            type="range"
            className="scrubber absolute inset-x-0 -top-1.5 h-6 w-full"
            min={start}
            max={end}
            step={5 * 60_000}
            value={playhead}
            onChange={(e) => {
              setPlaying(false)
              onChange(Number(e.target.value))
            }}
            aria-label="Trip time"
            aria-valuetext={`${whenText}, ${doing}`}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR[ev.status] }} aria-hidden />
        <span className="font-semibold text-ink">{doing}</span>
        <span className="text-muted">
          {ev.location_label ? `${ev.status === 'D' ? 'from ' : 'at '}${ev.location_label}` : ''}
          {' · '}mile {Math.round(clocks.mile).toLocaleString('en-US')}
        </span>
        <span className="num ml-auto text-xs font-medium text-ink-soft">
          Day {clocks.dayIndex + 1} · {whenText}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4 lg:grid-cols-4">
        <Gauge label="Driving" used={clocks.driving} limit={LIMITS.driving} />
        <Gauge label="Duty window" used={clocks.window ?? 0} limit={LIMITS.window} idle={clocks.window === null ? 'Off' : undefined} />
        <Gauge label="Until break" used={clocks.sinceBreak} limit={LIMITS.sinceBreak} />
        <Gauge label="70-hr cycle" used={clocks.cycle} limit={LIMITS.cycle} />
      </div>

      {clocks.rest && (
        <div className="mt-4 rounded-lg bg-paper px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-ink">
              {KIND_LABEL[clocks.rest.kind]} in progress
              <span className="font-normal text-muted">
                {' · '}
                {clocks.rest.kind === 'restart'
                  ? 'resets the 70-hr cycle'
                  : clocks.rest.kind === 'reset'
                    ? 'resets the 11-hr and 14-hr clocks'
                    : 'resets the 8-hr break clock'}
              </span>
            </span>
            <span className="tabular shrink-0 text-muted">
              {fmtDuration(clocks.rest.done / 60)} / {fmtDuration(clocks.rest.target / 60)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="glow h-full rounded-full bg-ok"
              style={{ width: `${(clocks.rest.done / clocks.rest.target) * 100}%` }}
            />
          </div>
        </div>
      )}
    </Card>
  )
}
