/**
 * The API returns naive ISO datetimes in home-terminal time (§395.8). Parsing them without
 * a zone makes JS treat them as local wall-clock, and formatting without a zone prints the
 * same wall-clock back — so no time-zone conversion ever happens in the UI.
 */
export function parseLocal(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
}

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const longDayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

export const fmtTime = (iso: string) => timeFmt.format(parseLocal(iso))
export const fmtDay = (iso: string) => dayFmt.format(parseLocal(iso))
export const fmtLongDay = (iso: string) => longDayFmt.format(parseLocal(iso))
export const fmtDayTime = (iso: string) => `${fmtDay(iso)} · ${fmtTime(iso)}`

/** 8.5 -> "8h 30m"; 30.25 -> "1d 6h 15m" when `days` is set. */
export function fmtDuration(hours: number, { days = false } = {}): string {
  const totalMin = Math.round(hours * 60)
  let h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (days && h >= 24) {
    const d = Math.floor(h / 24)
    h %= 24
    return `${d}d ${h}h${m ? ` ${m}m` : ''}`
  }
  if (h === 0) return `${m}m`
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`
}

export const fmtMiles = (mi: number, digits = 0) =>
  `${mi.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} mi`

export const fmtHours = (h: number) => h.toFixed(2)

/** "2026-09-22" -> { month: "09", day: "22", year: "2026" } */
export function dateParts(date: string) {
  const [year, month, day] = date.split('-')
  return { year, month, day }
}

/** Value for <input type="datetime-local">: the next 06:00 local. */
export function defaultStartLocal(now = new Date()): string {
  const d = new Date(now)
  d.setHours(6, 0, 0, 0)
  if (d < now) d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
