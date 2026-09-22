import type { EventKind, TripEvent, TripPlan } from '../api/types'

/**
 * One plain-English name per event kind, used everywhere (itinerary, map popups, log
 * remarks) so the same stop never goes by two names.
 */
export const KIND_LABEL: Record<EventKind, string> = {
  off_duty: 'Off duty',
  pre_trip: 'Pre-trip inspection',
  drive: 'Driving',
  pickup: 'Pickup',
  fuel: 'Fuel stop',
  break: '30-min break',
  reset: '10-hr rest',
  restart: '34-hr restart',
  dropoff: 'Drop-off',
  post_trip: 'Post-trip inspection',
}

/** The rule behind each kind of stop, for the "Why these stops?" panel. */
export const KIND_RULE: Partial<Record<EventKind, string>> = {
  fuel: 'Refuel at least every 1,000 miles',
  break: 'Required after 8 hours of driving',
  reset: 'Required after 11 hours of driving or 14 hours on duty',
  restart: 'Resets the 70-hour / 8-day limit to zero',
}

const MIN = 60_000
const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / MIN

/**
 * Why each stop happened, in plain words, e.g. "11-hr driving limit reached".
 * Replays the timeline with the same clocks the backend uses (§395.3), keyed by event start.
 */
export function explainStops(plan: TripPlan): Map<string, string> {
  const out = new Map<string, string>()
  let windowStart: string | null = null
  let shiftDrive = 0
  let restRun = 0

  const key = (e: TripEvent) => `${e.start}|${e.kind}`

  for (const e of plan.events) {
    const mins = minutesBetween(e.start, e.end)
    switch (e.kind) {
      case 'pre_trip':
        out.set(key(e), '15-min safety check before driving')
        break
      case 'post_trip':
        out.set(key(e), '15-min safety check after the trip')
        break
      case 'pickup':
        out.set(key(e), '1 hr loading, on duty')
        break
      case 'dropoff':
        out.set(key(e), '1 hr unloading, on duty')
        break
      case 'fuel':
        out.set(key(e), 'Refuel, required every 1,000 mi')
        break
      case 'break':
        out.set(key(e), 'After 8 hr of driving')
        break
      case 'restart':
        out.set(key(e), '70-hr / 8-day limit reached')
        break
      case 'reset': {
        const onDuty = windowStart ? minutesBetween(windowStart, e.start) : 0
        out.set(
          key(e),
          shiftDrive >= 11 * 60 - 1
            ? '11-hr driving limit reached'
            : onDuty >= 14 * 60 - 30
              ? '14-hr on-duty window closed'
              : 'End of duty day',
        )
        break
      }
    }

    // advance the clocks
    if (e.status === 'OFF' || e.status === 'SB') {
      restRun += mins
      if (restRun >= 10 * 60) {
        windowStart = null
        shiftDrive = 0
      }
    } else {
      restRun = 0
      windowStart ??= e.start
      if (e.status === 'D') shiftDrive += mins
    }
  }
  return out
}

export const explainKey = (start: string, kind: EventKind) => `${start}|${kind}`
