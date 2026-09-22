import type { EventKind, TripPlan } from '../../api/types'
import { KIND_RULE } from '../../lib/explain'
import { fmtDay, fmtDayTime, fmtDuration, fmtTime } from '../../lib/format'
import { STOP_HEX, type StopType } from '../../lib/stops'
import { Card, ComplianceBadge } from '../ui/primitives'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="num mt-1 text-[21px] font-bold leading-tight tracking-tight text-ink sm:text-[25px]">{value}</dd>
      {sub && <dd className="tabular mt-0.5 truncate text-xs text-muted">{sub}</dd>}
    </div>
  )
}

const REASON_ROWS: { kind: EventKind; type: StopType; one: string; many: string }[] = [
  { kind: 'reset', type: 'reset', one: '10-hr rest', many: '10-hr rests' },
  { kind: 'break', type: 'break', one: '30-min break', many: '30-min breaks' },
  { kind: 'restart', type: 'restart', one: '34-hr restart', many: '34-hr restarts' },
  { kind: 'fuel', type: 'fuel', one: 'fuel stop', many: 'fuel stops' },
]

export function SummaryPanel({ plan }: { plan: TripPlan }) {
  const s = plan.summary
  const count: Record<string, number> = {
    reset: s.resets_10hr,
    break: s.breaks_30min,
    restart: s.restarts_34hr,
    fuel: s.fuel_stops,
  }
  const reasons = REASON_ROWS.filter((r) => count[r.kind] > 0)
  const arrival = s.dropoff_arrival ?? s.trip_end

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-strong">Trip summary</p>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-ink">
            {plan.input.current_location.label} <span className="text-accent">→</span> {plan.input.pickup_location.label}{' '}
            <span className="text-accent">→</span> {plan.input.dropoff_location.label}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Leaves {fmtDayTime(s.trip_start)} · starts with {s.cycle_used_start} of 70 cycle hours used
          </p>
        </div>
        <ComplianceBadge
          ok={plan.compliance.ok}
          title="Every stop was re-checked against the FMCSA limits: 11-hr driving, 14-hr window, 30-min break, 70-hr / 8-day"
        />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat label="Distance" value={`${Math.round(s.total_miles).toLocaleString('en-US')} mi`} sub={`${Math.round(s.pickup_mile).toLocaleString('en-US')} mi to pickup`} />
        <Stat label="Driving time" value={fmtDuration(s.total_driving_hours)} sub={`over ${fmtDuration(s.total_trip_duration_hours, { days: true })} total`} />
        <Stat label="Arrives" value={fmtDay(arrival)} sub={`${fmtTime(arrival)} at drop-off`} />
        <Stat label="Log sheets" value={String(s.number_of_days)} sub={s.number_of_days === 1 ? 'one calendar day' : 'one per calendar day'} />
      </dl>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Why these stops?</p>
        {reasons.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            Short enough to drive in one duty day. No rest stops required, only pickup and drop-off.
          </p>
        ) : (
          <ul className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {reasons.map((r) => {
              const n = count[r.kind]
              return (
                <li key={r.kind} className="flex items-start gap-2.5">
                  <span
                    className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ background: STOP_HEX[r.type] }}
                    aria-hidden
                  >
                    {n}
                  </span>
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-ink first-letter:uppercase">{n === 1 ? r.one : r.many}</span>
                    <span className="block text-xs text-muted">{KIND_RULE[r.kind]}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
