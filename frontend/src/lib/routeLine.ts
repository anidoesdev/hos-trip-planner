import type { TripPlan } from '../api/types'
import { haversineMiles as haversine, type LatLng } from './geo'

/**
 * Position at any trip mile along the route polyline. Each leg's vertex distances are scaled
 * to the router's reported miles for that leg, matching the backend's `RouteLine`, so the
 * truck marker lines up with the stops the engine placed.
 */
export function buildRouteLine(plan: TripPlan): (mile: number) => LatLng {
  const pts: LatLng[] = []
  const cum: number[] = []
  let offset = 0
  for (const leg of plan.route.legs) {
    const g = leg.geometry
    if (g.length === 0) continue
    const raw = [0]
    for (let i = 1; i < g.length; i++) raw.push(raw[i - 1] + haversine(g[i - 1], g[i]))
    const span = raw[raw.length - 1]
    const scale = span > 0 ? leg.miles / span : 0
    g.forEach((p, i) => {
      pts.push(p)
      cum.push(offset + raw[i] * scale)
    })
    offset += leg.miles
  }
  if (pts.length === 0) {
    const p = plan.input.current_location
    return () => [p.lat, p.lng]
  }
  return (mile: number) => {
    if (mile <= cum[0]) return pts[0]
    if (mile >= cum[cum.length - 1]) return pts[pts.length - 1]
    let lo = 0
    let hi = cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= mile) lo = mid
      else hi = mid
    }
    const f = cum[hi] > cum[lo] ? (mile - cum[lo]) / (cum[hi] - cum[lo]) : 0
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f]
  }
}
