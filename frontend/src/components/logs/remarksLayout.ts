import type { LogSegment } from '../../api/types'

/**
 * Remarks for the paper log (guide pp.17-19): every change of duty status is marked under
 * the grid, and the place is written once per stop. As in the FMCSA "Completed Log"
 * (Richmond → Fredericksburg → Baltimore → …), each run of non-driving time at one place
 * becomes a single bracket spanning that stop with a single "City, ST" label.
 */
export interface RemarkStop {
  startMin: number
  endMin: number
  location: string
  detail: string
}

export function buildRemarkStops(segments: LogSegment[]): RemarkStop[] {
  const stops: RemarkStop[] = []
  let run: LogSegment[] = []

  const flush = () => {
    if (run.length === 0) return
    // Trim the midnight Off Duty padding (before the trip starts / after it ends) so the
    // bracket covers the real stop, not the rest of the day.
    let trimmed = run
    while (trimmed.length > 1 && trimmed[0].kind === 'off_duty') trimmed = trimmed.slice(1)
    while (trimmed.length > 1 && trimmed[trimmed.length - 1].kind === 'off_duty') trimmed = trimmed.slice(0, -1)
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    const notes = [...new Set(trimmed.filter((s) => s.kind !== 'off_duty').map((s) => s.note))]
    if (first.kind === 'off_duty' && trimmed.length === 1) {
      // Pure padding: only worth a remark where it meets a duty change.
      const atEdge = first.start_minute > 0 ? first.start_minute : first.end_minute
      if (atEdge > 0 && atEdge < 1440) {
        stops.push({ startMin: atEdge, endMin: atEdge, location: first.location_label ?? '', detail: 'Off duty' })
      }
    } else {
      stops.push({
        startMin: first.start_minute,
        endMin: last.end_minute,
        location: first.location_label ?? '',
        detail: notes.join(' · '),
      })
    }
    run = []
  }

  for (const seg of segments) {
    if (seg.status === 'D') flush()
    else run.push(seg)
  }
  flush()
  return stops
}

/**
 * Horizontal anchors for rotated labels so none overlap. The labels are parallel lines
 * (all rotated by the same angle), so two of them clear each other when their anchors are
 * at least `minGap` px apart. Push right in one pass, then pull back from the right edge.
 */
export function spreadAnchors(xs: number[], minGap: number, minX: number, maxX: number): number[] {
  const out = [...xs]
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(out[i], minX, i > 0 ? out[i - 1] + minGap : -Infinity)
  }
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Math.min(out[i], maxX, i < out.length - 1 ? out[i + 1] - minGap : Infinity)
  }
  return out
}

export function minuteToClock(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
