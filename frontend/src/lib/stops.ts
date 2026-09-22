import {
  BedDouble,
  ClipboardCheck,
  Coffee,
  Flag,
  Fuel,
  MapPin,
  MoonStar,
  PackageOpen,
  type LucideIcon,
} from 'lucide-react'
import type { EventKind, Stop, TripPlan } from '../api/types'

/** Visual categories used by the map, legend and itinerary. */
export type StopType = 'start' | 'pickup' | 'dropoff' | 'fuel' | 'break' | 'reset' | 'restart' | 'inspection'

export interface StopMeta {
  label: string
  color: string
  icon: LucideIcon
  /** Higher wins when several stops share one map marker. */
  priority: number
}

export const STOP_META: Record<StopType, StopMeta> = {
  start: { label: 'Start', color: 'var(--color-stop-start)', icon: MapPin, priority: 9 },
  pickup: { label: 'Pickup', color: 'var(--color-stop-pickup)', icon: PackageOpen, priority: 8 },
  dropoff: { label: 'Drop-off', color: 'var(--color-stop-dropoff)', icon: Flag, priority: 8 },
  restart: { label: '34-hr restart', color: 'var(--color-stop-restart)', icon: MoonStar, priority: 6 },
  reset: { label: '10-hr rest', color: 'var(--color-stop-reset)', icon: BedDouble, priority: 5 },
  fuel: { label: 'Fuel stop', color: 'var(--color-stop-fuel)', icon: Fuel, priority: 4 },
  break: { label: '30-min break', color: 'var(--color-stop-break)', icon: Coffee, priority: 3 },
  inspection: { label: 'Inspection', color: 'var(--color-stop-inspection)', icon: ClipboardCheck, priority: 1 },
}

/**
 * Badge colors, used in inline styles (HTML, where CSS variables work, including Leaflet
 * divIcons). Start follows the theme: dark ink by day, a light badge at night.
 */
export const STOP_HEX: Record<StopType, string> = {
  start: 'var(--color-stop-start)',
  pickup: '#059669',
  dropoff: '#e11d48',
  fuel: '#d97706',
  break: '#0284c7',
  reset: '#4f46e5',
  restart: '#7c3aed',
  inspection: '#64748b',
}

/** Icon color on each badge: white, except Start at night (light badge, dark icon). */
export const STOP_ON: Record<StopType, string> = {
  start: 'var(--color-on-stop-start)',
  pickup: '#fff',
  dropoff: '#fff',
  fuel: '#fff',
  break: '#fff',
  reset: '#fff',
  restart: '#fff',
  inspection: '#fff',
}

export const LEGEND_ORDER: StopType[] = ['start', 'pickup', 'dropoff', 'fuel', 'break', 'reset', 'restart']

export function stopTypeOf(kind: EventKind): StopType | null {
  switch (kind) {
    case 'pickup':
    case 'dropoff':
    case 'fuel':
    case 'break':
    case 'reset':
    case 'restart':
      return kind
    case 'pre_trip':
    case 'post_trip':
      return 'inspection'
    default:
      return null
  }
}

export interface StopItem extends Stop {
  id: string
  type: StopType
}

/** A map marker: every stop at (almost) the same coordinates collapses into one pin. */
export interface StopGroup {
  id: string
  lat: number
  lng: number
  type: StopType
  label: string
  items: StopItem[]
}

export function buildStopItems(plan: TripPlan): StopItem[] {
  return plan.stops
    .map((s, i) => ({ ...s, id: `stop-${i}`, type: stopTypeOf(s.kind) }))
    .filter((s): s is StopItem => s.type !== null && s.lat !== null && s.lng !== null)
}

const SAME_PLACE_DEG = 0.002 // ~200 m

export function groupStops(plan: TripPlan, items: StopItem[]): StopGroup[] {
  const groups: StopGroup[] = []
  const start = plan.input.current_location
  groups.push({ id: 'start', lat: start.lat, lng: start.lng, type: 'start', label: start.label, items: [] })

  for (const item of items) {
    const g = groups.find(
      (x) => Math.abs(x.lat - item.lat!) < SAME_PLACE_DEG && Math.abs(x.lng - item.lng!) < SAME_PLACE_DEG,
    )
    if (g) {
      g.items.push(item)
      if (STOP_META[item.type].priority > STOP_META[g.type].priority) g.type = item.type
    } else {
      groups.push({
        id: `g-${item.id}`,
        lat: item.lat!,
        lng: item.lng!,
        type: item.type,
        label: item.location_label ?? '',
        items: [item],
      })
    }
  }
  return groups
}

export function groupIdForStop(groups: StopGroup[], stopId: string): string | undefined {
  return groups.find((g) => g.items.some((i) => i.id === stopId))?.id
}
