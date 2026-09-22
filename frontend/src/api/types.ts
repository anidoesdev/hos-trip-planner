/** Types mirroring the Django API response of POST /api/trip/plan (see backend/README.md). */

export type DutyStatus = 'OFF' | 'SB' | 'D' | 'ON'

export type EventKind =
  | 'off_duty'
  | 'pre_trip'
  | 'drive'
  | 'pickup'
  | 'fuel'
  | 'break'
  | 'reset'
  | 'restart'
  | 'dropoff'
  | 'post_trip'

export interface GeoPoint {
  lat: number
  lng: number
  label: string
}

export interface TripEvent {
  start: string
  end: string
  status: DutyStatus
  kind: EventKind
  note: string
  duration_hours: number
  miles_start: number
  miles_end: number
  lat: number | null
  lng: number | null
  location_label: string | null
}

export interface Stop extends Omit<TripEvent, 'miles_start' | 'miles_end'> {
  mile: number
}

export interface RouteLeg {
  from: string
  to: string
  miles: number
  duration_hours: number
  avg_mph: number | null
  geometry: [number, number][]
}

export interface Route {
  provider: string
  geometry: [number, number][]
  legs: RouteLeg[]
  total_miles: number
  total_duration_hours: number
}

export interface LogSegment {
  status: DutyStatus
  kind: EventKind
  note: string
  start_minute: number
  end_minute: number
  start: string
  end: string
  location_label: string | null
}

export interface LogRemark {
  time: string
  minute: number
  status: DutyStatus
  location: string | null
  note: string
}

export interface Violation {
  rule: string
  cfr: string
  at: string
  message: string
}

export interface Compliance {
  ok: boolean
  violations: Violation[]
}

export interface DailyLog {
  day_number: number
  date: string
  from_location: string | null
  to_location: string | null
  total_miles_driving_today: number
  segments: LogSegment[]
  totals_minutes: Record<DutyStatus, number>
  totals_hours: Record<DutyStatus, number>
  total_hours: number
  remarks: LogRemark[]
  recap: {
    on_duty_today: number
    cycle_total_hours: number
    hours_available_tomorrow: number
    restart_taken: boolean
    cycle_used_prior: number
  }
  compliance?: Compliance
}

export interface TripSummary {
  total_miles: number
  pickup_mile: number
  total_driving_hours: number
  total_on_duty_not_driving_hours: number
  total_trip_duration_hours: number
  trip_start: string
  pickup_arrival: string | null
  dropoff_arrival: string | null
  trip_end: string
  number_of_days: number
  breaks_30min: number
  resets_10hr: number
  restarts_34hr: number
  fuel_stops: number
  cycle_used_start: number
}

export interface TripPlan {
  input: {
    current_location: GeoPoint
    pickup_location: GeoPoint
    dropoff_location: GeoPoint
    current_cycle_used: number
    start_datetime: string
    home_terminal_timezone: string
  }
  route: Route
  events: TripEvent[]
  stops: Stop[]
  daily_logs: DailyLog[]
  summary: TripSummary
  compliance: Compliance
}

export interface TripRequest {
  current_location: string
  pickup_location: string
  dropoff_location: string
  current_cycle_used: number
  start_datetime?: string | null
}

export interface ApiErrorBody {
  error: string
  message: string
  field?: string
  fields?: Record<string, string[]>
}
