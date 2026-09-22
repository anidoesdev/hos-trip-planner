import type { EventKind, TripEvent, TripPlan } from '../api/types'
import { parseLocal } from './format'

/** HOS limits in minutes (49 CFR §395.3). */
export const LIMITS = {
  driving: 11 * 60, // §395.3(a)(3)
  window: 14 * 60, // §395.3(a)(2)
  sinceBreak: 8 * 60, // §395.3(a)(3)(ii)
  cycle: 70 * 60, // §395.3(b)
  reset: 10 * 60,
  restart: 34 * 60,
  break: 30,
} as const

export interface Clocks {
  /** The event in progress at the playhead. */
  event: TripEvent
  dayIndex: number
  minuteOfDay: number
  mile: number
  /** Minutes used against each limit. `window` is null while no duty period is open. */
  driving: number
  window: number | null
  sinceBreak: number
  cycle: number
  /** While resting: minutes into the current off-duty run and the target that resets a clock. */
  rest: { done: number; target: number; kind: EventKind } | null
}

const ms = (iso: string) => parseLocal(iso).getTime()

function localDate(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Replay the timeline up to time `t` (epoch ms, home-terminal wall clock) and return every
 * HOS clock at that moment, using the same bookkeeping as the backend validator.
 */
export function clocksAt(plan: TripPlan, t: number): Clocks {
  let windowStart: number | null = null
  let driving = 0
  let sinceBreak = 0
  let nondrive = 0
  let rest = LIMITS.reset // the driver starts rested
  let cycle = plan.input.current_cycle_used * 60
  let current = plan.events[0]

  for (const e of plan.events) {
    const s = ms(e.start)
    if (s > t) break
    current = e
    const m = (Math.min(ms(e.end), t) - s) / 60_000
    if (e.status === 'OFF' || e.status === 'SB') {
      rest += m
      nondrive += m
      if (rest >= LIMITS.reset) {
        windowStart = null
        driving = 0
      }
      if (rest >= LIMITS.restart) cycle = 0
    } else {
      rest = 0
      windowStart ??= s
      cycle += m
      if (e.status === 'ON') nondrive += m
    }
    if (e.status === 'D') {
      nondrive = 0
      driving += m
      sinceBreak += m
    } else if (nondrive >= LIMITS.break) {
      sinceBreak = 0
    }
  }

  const frac = Math.min(1, Math.max(0, (t - ms(current.start)) / (ms(current.end) - ms(current.start) || 1)))
  const mile = current.status === 'D' ? current.miles_start + (current.miles_end - current.miles_start) * frac : current.miles_start
  const d = new Date(t)
  const target =
    current.kind === 'restart' ? LIMITS.restart : current.kind === 'reset' ? LIMITS.reset : current.kind === 'break' ? LIMITS.break : 0

  return {
    event: current,
    dayIndex: Math.max(0, plan.daily_logs.findIndex((l) => l.date === localDate(t))),
    minuteOfDay: d.getHours() * 60 + d.getMinutes(),
    mile,
    driving,
    window: windowStart === null ? null : (t - windowStart) / 60_000,
    sinceBreak,
    cycle,
    rest: target ? { done: Math.min(rest, target), target, kind: current.kind } : null,
  }
}

export function tripBounds(plan: TripPlan): { start: number; end: number } {
  return { start: ms(plan.summary.trip_start), end: ms(plan.summary.trip_end) }
}
