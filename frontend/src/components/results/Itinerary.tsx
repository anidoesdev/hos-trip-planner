import { Fragment, useMemo } from 'react'
import { Navigation } from 'lucide-react'
import type { TripPlan } from '../../api/types'
import { fmtDay, fmtDuration, fmtMiles, fmtTime } from '../../lib/format'
import { STOP_HEX, STOP_META, stopTypeOf, type StopItem, type StopType } from '../../lib/stops'
import { cx } from '../ui/primitives'

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'stop'; key: string; stop: StopItem | null; type: StopType; title: string; place: string; start: string; hours: number; mile: number }
  | { kind: 'drive'; key: string; miles: number; hours: number }

interface Props {
  plan: TripPlan
  items: StopItem[]
  selectedStopId: string | null
  onSelectStop: (stopId: string | null, groupId?: string) => void
}

/** Chronological, stop-by-stop plan. Drives between stops appear as connectors. */
export function Itinerary({ plan, items, selectedStopId, onSelectStop }: Props) {
  const rows = useMemo(() => {
    const out: Row[] = []
    let lastDay = ''
    let itemIdx = 0
    const pushDay = (iso: string) => {
      const d = iso.slice(0, 10)
      if (d !== lastDay) {
        lastDay = d
        const n = plan.daily_logs.findIndex((l) => l.date === d) + 1
        out.push({ kind: 'day', key: `day-${d}`, label: `Day ${n} · ${fmtDay(d)}` })
      }
    }
    pushDay(plan.summary.trip_start)
    if (!plan.events.some((e) => e.kind === 'pre_trip')) {
      const p = plan.input.current_location
      out.push({ kind: 'stop', key: 'start', stop: null, type: 'start', title: 'Depart', place: p.label, start: plan.summary.trip_start, hours: 0, mile: 0 })
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
      // stops[] is the same non-driving events in the same order
      const stop = items[itemIdx]?.start === ev.start ? items[itemIdx++] : null
      out.push({
        kind: 'stop',
        key: `s-${ev.start}-${ev.kind}`,
        stop,
        type: ev.kind === 'pre_trip' ? 'start' : type,
        title: ev.note,
        place: ev.location_label ?? '',
        start: ev.start,
        hours: ev.duration_hours,
        mile: ev.miles_start,
      })
    }
    return out
  }, [plan, items])

  return (
    <ol className="relative">
      {rows.map((row) => {
        if (row.kind === 'day')
          return (
            <li key={row.key} className="sticky top-0 z-10 -mx-1 bg-surface/95 px-1 pb-1.5 pt-3 backdrop-blur-sm first:pt-0">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{row.label}</span>
            </li>
          )
        if (row.kind === 'drive')
          return (
            <li key={row.key} className="flex items-center gap-3 py-0.5 pl-[13px]">
              <span className="h-7 border-l-2 border-dashed border-line-strong" aria-hidden />
              <span className="tabular flex items-center gap-1.5 text-xs text-muted">
                <Navigation className="size-3 rotate-90" aria-hidden />
                Drive {fmtMiles(row.miles)} · {fmtDuration(row.hours)}
              </span>
            </li>
          )
        const meta = STOP_META[row.type]
        const Icon = meta.icon
        const selected = !!row.stop && row.stop.id === selectedStopId
        return (
          <Fragment key={row.key}>
            <li>
              <button
                type="button"
                onClick={() => onSelectStop(row.stop?.id ?? null, row.stop ? undefined : 'start')}
                aria-pressed={selected}
                className={cx(
                  'group flex w-full items-start gap-3 rounded-lg p-1.5 text-left transition-colors',
                  selected ? 'bg-accent-soft/70' : 'hover:bg-paper',
                )}
              >
                <span
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-2 ring-white"
                  style={{ background: STOP_HEX[row.type] }}
                  aria-hidden
                >
                  <Icon className="size-3.5 text-white" strokeWidth={2.4} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{row.title}</span>
                    <span className="tabular shrink-0 text-xs font-medium text-ink-soft">{fmtTime(row.start)}</span>
                  </span>
                  <span className="tabular flex items-baseline justify-between gap-2 text-xs text-muted">
                    <span className="truncate">{row.place}</span>
                    <span className="shrink-0">
                      {row.hours > 0 ? fmtDuration(row.hours) : ''}
                      {row.mile > 0 ? ` · mi ${Math.round(row.mile).toLocaleString('en-US')}` : ''}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
