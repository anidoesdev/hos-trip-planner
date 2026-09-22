import { useMemo } from 'react'
import { Navigation } from 'lucide-react'
import type { TripPlan } from '../../api/types'
import { explainKey, explainStops, KIND_LABEL } from '../../lib/explain'
import { fmtDay, fmtDuration, fmtMiles, fmtTime, fmtWeekday } from '../../lib/format'
import { STOP_HEX, STOP_META, STOP_ON, stopTypeOf, type StopItem, type StopType } from '../../lib/stops'
import { MileTag, cx } from '../ui/primitives'

type Row =
  | { kind: 'day'; key: string; label: string }
  | {
      kind: 'stop'
      key: string
      stop: StopItem | null
      type: StopType
      title: string
      reason?: string
      place: string
      start: string
      end: string
      hours: number
      mile: number
      n: number
    }
  | { kind: 'drive'; key: string; miles: number; hours: number }

interface Props {
  plan: TripPlan
  items: StopItem[]
  selectedStopId: string | null
  onSelectStop: (stopId: string | null, groupId?: string) => void
}

/** Chronological, stop-by-stop plan. Each stop says what it is, when, where and why. */
export function Itinerary({ plan, items, selectedStopId, onSelectStop }: Props) {
  const rows = useMemo(() => {
    const reasons = explainStops(plan)
    const out: Row[] = []
    let lastDay = ''
    let itemIdx = 0
    let n = 0
    const pushDay = (iso: string) => {
      const d = iso.slice(0, 10)
      if (d === lastDay) return
      lastDay = d
      const n = plan.daily_logs.findIndex((l) => l.date === d) + 1
      out.push({ kind: 'day', key: `day-${d}`, label: `Day ${n} · ${fmtDay(d)}` })
    }
    pushDay(plan.summary.trip_start)
    if (!plan.events.some((e) => e.kind === 'pre_trip')) {
      const t = plan.summary.trip_start
      out.push({ kind: 'stop', key: 'start', stop: null, type: 'start', title: 'Depart', place: plan.input.current_location.label, start: t, end: t, hours: 0, mile: 0, n: ++n })
    }
    for (const ev of plan.events) {
      if (ev.kind === 'off_duty') continue
      pushDay(ev.start)
      if (ev.status === 'D') {
        out.push({ kind: 'drive', key: `d-${ev.start}`, miles: ev.miles_end - ev.miles_start, hours: ev.duration_hours })
        continue
      }
      const type = stopTypeOf(ev.kind)
      if (!type) continue
      // stops[] holds the same non-driving events in the same order
      const stop = items[itemIdx]?.start === ev.start ? items[itemIdx++] : null
      out.push({
        kind: 'stop',
        key: `s-${ev.start}-${ev.kind}`,
        stop,
        type: ev.kind === 'pre_trip' ? 'start' : type,
        title: KIND_LABEL[ev.kind],
        reason: reasons.get(explainKey(ev.start, ev.kind)),
        place: ev.location_label ?? '',
        start: ev.start,
        end: ev.end,
        hours: ev.duration_hours,
        mile: ev.miles_start,
        n: ++n,
      })
    }
    return out
  }, [plan, items])

  return (
    <ol className="relative" aria-label="Trip itinerary">
      {rows.map((row) => {
        if (row.kind === 'day')
          return (
            <li key={row.key} className="sticky top-0 z-10 -mx-1 bg-surface/95 px-1 pb-1.5 pt-3 backdrop-blur-sm first:pt-0">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{row.label}</span>
            </li>
          )
        if (row.kind === 'drive')
          return (
            <li key={row.key} className="flex items-center gap-3 py-0.5 pl-[14px]">
              <span className="h-7 border-l-2 border-dashed border-line-strong" aria-hidden />
              <span className="tabular flex items-center gap-1.5 text-xs text-muted">
                <Navigation className="size-3 rotate-90" aria-hidden />
                Drive {fmtMiles(row.miles)} · {fmtDuration(row.hours)}
              </span>
            </li>
          )
        const Icon = STOP_META[row.type].icon
        const selected = !!row.stop && row.stop.id === selectedStopId
        const spansDays = row.end.slice(0, 10) !== row.start.slice(0, 10)
        return (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onSelectStop(row.stop?.id ?? null, row.stop ? undefined : 'start')}
              aria-pressed={selected}
              title="Show on map"
              className={cx(
                'group flex w-full items-start gap-3 rounded-lg p-1.5 text-left transition-colors',
                selected ? 'bg-accent-soft/70' : 'hover:bg-paper',
              )}
            >
              <span
                className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-2 ring-surface"
                style={{ background: STOP_HEX[row.type] }}
                aria-hidden
              >
                <Icon className="size-3.5" style={{ color: STOP_ON[row.type] }} strokeWidth={2.4} />
                <span className="num absolute -bottom-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface px-0.5 text-[9px] font-bold text-ink ring-1 ring-line-strong">
                  {row.n}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-tight text-ink">{row.title}</span>
                <span className="num mt-0.5 block text-[11.5px] text-ink-soft">
                  {fmtTime(row.start)}
                  {row.hours > 0 && (
                    <>
                      {' – '}
                      {spansDays ? `${fmtWeekday(row.end)} ` : ''}
                      {fmtTime(row.end)}
                      <span className="font-normal text-muted"> · {fmtDuration(row.hours)}</span>
                    </>
                  )}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">{row.place}</span>
                  {row.mile > 0 && <MileTag mile={row.mile} className="shrink-0" />}
                </span>
                {row.reason && (
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft/80">{row.reason}</span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
