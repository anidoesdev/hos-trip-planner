import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, CalendarClock, Sparkles } from 'lucide-react'
import type { TripRequest } from '../../api/types'
import { defaultStartLocal } from '../../lib/format'
import { PRESETS, type Preset } from '../../lib/presets'
import { STOP_HEX } from '../../lib/stops'
import { Button, Card, cx } from '../ui/primitives'
import { CycleInput } from './CycleInput'
import { LocationInput } from './LocationInput'

interface FormState {
  current: string
  pickup: string
  dropoff: string
  cycle: string
  start: string
}

type Errors = Partial<Record<keyof FormState, string>>

const SERVER_FIELD: Record<string, keyof FormState> = {
  current_location: 'current',
  pickup_location: 'pickup',
  dropoff_location: 'dropoff',
  current_cycle_used: 'cycle',
  start_datetime: 'start',
}

function validate(s: FormState): Errors {
  const e: Errors = {}
  if (!s.current.trim()) e.current = 'Enter where the truck is now.'
  if (!s.pickup.trim()) e.pickup = 'Enter the pickup location.'
  if (!s.dropoff.trim()) e.dropoff = 'Enter the drop-off location.'
  const n = Number(s.cycle)
  if (s.cycle.trim() === '' || !Number.isFinite(n)) e.cycle = 'Enter hours used, 0–70.'
  else if (n < 0 || n > 70) e.cycle = 'Hours used must be between 0 and 70.'
  return e
}

function toRequest(s: FormState): TripRequest {
  return {
    current_location: s.current.trim(),
    pickup_location: s.pickup.trim(),
    dropoff_location: s.dropoff.trim(),
    current_cycle_used: Number(s.cycle),
    start_datetime: s.start ? `${s.start}:00` : null,
  }
}

interface Props {
  busy: boolean
  onSubmit: (req: TripRequest) => void
  /** Field errors returned by the API (location not found, validation). */
  serverErrors?: Record<string, string>
}

export function TripForm({ busy, onSubmit, serverErrors }: Props) {
  const [state, setState] = useState<FormState>({
    current: '',
    pickup: '',
    dropoff: '',
    cycle: '0',
    start: defaultStartLocal(),
  })
  const [errors, setErrors] = useState<Errors>({})
  const [activePreset, setActivePreset] = useState<string | null>(null)

  useEffect(() => {
    if (!serverErrors) return
    const mapped: Errors = {}
    for (const [field, msg] of Object.entries(serverErrors)) {
      const key = SERVER_FIELD[field]
      if (key) mapped[key] = msg
    }
    setErrors(mapped)
  }, [serverErrors])

  const set = (key: keyof FormState) => (value: string) => {
    setState((s) => ({ ...s, [key]: value }))
    setActivePreset(null)
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = (s: FormState) => {
    const e = validate(s)
    setErrors(e)
    if (Object.keys(e).length === 0) onSubmit(toRequest(s))
  }

  const onFormSubmit = (ev: FormEvent) => {
    ev.preventDefault()
    submit(state)
  }

  const runPreset = (p: Preset) => {
    const next = { ...state, current: p.current, pickup: p.pickup, dropoff: p.dropoff, cycle: String(p.cycle) }
    setState(next)
    setActivePreset(p.id)
    submit(next)
  }

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={onFormSubmit} noValidate>
        <div className="mb-5">
          <h2 className="text-lg font-semibold tracking-tight">Plan a trip</h2>
          <p className="mt-0.5 text-[13px] text-muted">Route, HOS-compliant stops and daily log sheets.</p>
        </div>

        <div className="relative space-y-4">
          <span
            className="pointer-events-none absolute left-[21px] top-[46px] bottom-[42px] border-l-2 border-dotted border-line-strong"
            aria-hidden
          />
          <LocationInput
            id="current"
            label="Current location"
            placeholder="e.g. Chicago, IL"
            value={state.current}
            onChange={set('current')}
            error={errors.current}
            markerColor={STOP_HEX.start}
            disabled={busy}
          />
          <LocationInput
            id="pickup"
            label="Pickup location"
            placeholder="e.g. Dallas, TX"
            value={state.pickup}
            onChange={set('pickup')}
            error={errors.pickup}
            markerColor={STOP_HEX.pickup}
            disabled={busy}
          />
          <LocationInput
            id="dropoff"
            label="Drop-off location"
            placeholder="e.g. Los Angeles, CA"
            value={state.dropoff}
            onChange={set('dropoff')}
            error={errors.dropoff}
            markerColor={STOP_HEX.dropoff}
            disabled={busy}
          />
        </div>

        <div className="mt-5 space-y-5 border-t border-line pt-5">
          <CycleInput value={state.cycle} onChange={set('cycle')} error={errors.cycle} disabled={busy} />

          <div>
            <label htmlFor="start" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
              <CalendarClock className="size-3.5" aria-hidden /> Start date &amp; time
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="start"
              type="datetime-local"
              value={state.start}
              disabled={busy}
              onChange={(e) => set('start')(e.target.value)}
              className="tabular h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] focus:border-ink/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <p className="mt-1 text-xs text-muted">Home-terminal time. Leave as is to start at the next 6:00 AM.</p>
          </div>
        </div>

        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-6 w-full">
          {busy ? 'Planning…' : 'Plan trip & generate logs'}
          {!busy && <ArrowRight className="size-4" aria-hidden />}
        </Button>
      </form>

      <div className="mt-6 border-t border-line pt-5">
        <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          <Sparkles className="size-3.5 text-accent" aria-hidden /> Try an example
        </p>
        <div className="grid grid-cols-1 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => runPreset(p)}
              className={cx(
                'group flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50',
                activePreset === p.id
                  ? 'border-accent bg-accent-soft/60'
                  : 'border-line hover:border-line-strong hover:bg-paper',
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{p.title}</span>
                <span className="block truncate text-xs text-muted">{p.blurb}</span>
              </span>
              <span className="tabular shrink-0 rounded-md bg-paper px-1.5 py-0.5 text-[11px] font-medium text-ink-soft group-hover:bg-surface">
                {p.cycle} h used
              </span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}
