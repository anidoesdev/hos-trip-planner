import type { TripPlan } from '../../api/types'
import { fmtDayTime, fmtDuration } from '../../lib/format'
import { STOP_HEX, type StopType } from '../../lib/stops'

const COUNT_LABEL: Partial<Record<StopType, string>> = {
  fuel: 'fuel stop',
  break: '30-min break',
  reset: '10-hr rest',
  restart: '34-hr restart',
}
import { Card, ComplianceBadge } from '../ui/primitives'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="tabular mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</dd>
      {sub && <dd className="tabular mt-0.5 truncate text-xs text-muted">{sub}</dd>}
    </div>
  )
}

export function SummaryPanel({ plan }: { plan: TripPlan }) {
  const s = plan.summary
  const counts: [StopType, number][] = [
    ['fuel', s.fuel_stops],
    ['break', s.breaks_30min],
    ['reset', s.resets_10hr],
    ['restart', s.restarts_34hr],
  ]
  const legs = plan.route.legs
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Trip summary</p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-ink">
            {plan.input.current_location.label} <span className="text-muted">→</span> {plan.input.pickup_location.label}{' '}
            <span className="text-muted">→</span> {plan.input.dropoff_location.label}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Departs {fmtDayTime(s.trip_start)} · arrives {s.dropoff_arrival ? fmtDayTime(s.dropoff_arrival) : '—'} ·{' '}
            {s.cycle_used_start} h cycle used at start
          </p>
        </div>
        <ComplianceBadge
          ok={plan.compliance.ok}
          title="Independently re-checked: 11-hr driving, 14-hr window, 30-min break, 70-hr/8-day, fuel interval, 24-hr day totals"
        />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat
          label="Distance"
          value={`${Math.round(s.total_miles).toLocaleString('en-US')} mi`}
          sub={legs.map((l) => `${Math.round(l.miles).toLocaleString('en-US')}`).join(' + ') + ' mi'}
        />
        <Stat label="Driving" value={fmtDuration(s.total_driving_hours)} sub={`${s.total_on_duty_not_driving_hours} h on-duty work`} />
        <Stat label="Trip duration" value={fmtDuration(s.total_trip_duration_hours, { days: true })} sub="start to post-trip" />
        <Stat label="Log days" value={String(s.number_of_days)} sub={`${plan.daily_logs.length} sheets`} />
      </dl>

      <ul className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4" aria-label="Stops by type">
        {counts.map(([type, n]) => (
          <li
            key={type}
            className="tabular flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft"
          >
            <span className="size-2 rounded-full" style={{ background: STOP_HEX[type] }} aria-hidden />
            <span className="font-semibold text-ink">{n}</span> {COUNT_LABEL[type]}
            {n === 1 ? '' : 's'}
          </li>
        ))}
        <li className="flex items-center text-xs text-muted">
          Routing: {plan.route.provider.replace(':', ' · ')}
        </li>
      </ul>
    </Card>
  )
}
