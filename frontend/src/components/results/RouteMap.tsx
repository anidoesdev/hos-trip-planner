import { useEffect, useMemo, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import type { TripPlan } from '../../api/types'
import { KIND_LABEL } from '../../lib/explain'
import { MileTag } from '../ui/primitives'
import { fmtDayTime, fmtDuration, fmtMiles } from '../../lib/format'
import { LEGEND_ORDER, STOP_HEX, STOP_META, STOP_ON, type StopGroup, type StopType } from '../../lib/stops'
import { Truck } from 'lucide-react'
import type { Theme } from '../../hooks/useTheme'

/**
 * Leaflet writes path colors as SVG attributes, which cannot read CSS variables, so the
 * route palette is chosen per theme here: dark taupe by day, teal at night. The truck and
 * the playhead use the accent color so they stand out on the route.
 */
const ROUTE_COLORS: Record<Theme, { loaded: string; deadhead: string; casing: string; flow: string }> = {
  light: { loaded: '#6f624c', deadhead: '#a0937d', casing: '#fff9ee', flow: '#fff9ee' },
  dark: { loaded: '#76abae', deadhead: '#a7aeb8', casing: '#222831', flow: '#222831' },
}

interface Props {
  plan: TripPlan
  groups: StopGroup[]
  selectedGroupId: string | null
  onSelectGroup: (id: string) => void
  /** Where the playback puts the truck right now. */
  truckAt?: [number, number] | null
  theme?: Theme
}

const truckIcon = L.divIcon({
  html: `<div style="width:30px;height:30px;border-radius:9px;background:var(--color-truck);border:2.5px solid #fff;box-shadow:0 3px 10px rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center">${renderToStaticMarkup(<Truck size={16} color="#fff" strokeWidth={2.4} aria-hidden />)}</div>`,
  className: 'stop-marker',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})

const iconCache = new Map<string, L.DivIcon>()

function stopIcon(type: StopType, count: number): L.DivIcon {
  const key = `${type}-${count}`
  const hit = iconCache.get(key)
  if (hit) return hit
  const Icon = STOP_META[type].icon
  const major = type === 'start' || type === 'pickup' || type === 'dropoff'
  const size = major ? 34 : 28
  // the glyph strokes in currentColor, so the badge's `color` sets it (light or dark icon)
  const glyph = renderToStaticMarkup(<Icon size={major ? 17 : 14} strokeWidth={2.4} aria-hidden />)
  const badge =
    count > 1
      ? `<span style="position:absolute;top:-5px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#fff;color:#0f172a;font:600 10px/16px Inter Variable,sans-serif;text-align:center;box-shadow:0 0 0 1px rgba(15,23,42,.15)">${count}</span>`
      : ''
  const html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${STOP_HEX[type]};color:${STOP_ON[type]};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center">${glyph}${badge}</div>`
  const icon = L.divIcon({
    html,
    className: 'stop-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
  iconCache.set(key, icon)
  return icon
}

function FitToRoute({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap()
  useEffect(() => {
    // no animation: leaving the results mid-zoom would otherwise crash Leaflet's zoom-end handler
    map.fitBounds(bounds, { padding: [36, 36], animate: false })
  }, [map, bounds])
  return null
}

function FlyToSelected({ groups, selectedGroupId, markers }: {
  groups: StopGroup[]
  selectedGroupId: string | null
  markers: React.RefObject<Map<string, L.Marker>>
}) {
  const map = useMap()
  useEffect(() => {
    const g = groups.find((x) => x.id === selectedGroupId)
    if (!g) return
    map.flyTo([g.lat, g.lng], Math.max(map.getZoom(), 9), { duration: 0.6 })
    const t = setTimeout(() => markers.current?.get(g.id)?.openPopup(), 650)
    return () => {
      clearTimeout(t)
      map.stop() // end any fly-to still running if the map is about to unmount
    }
  }, [map, groups, selectedGroupId, markers])
  return null
}

function GroupPopup({ group }: { group: StopGroup }) {
  return (
    <div className="min-w-[200px]">
      <p className="text-[13px] font-semibold text-ink">{group.label}</p>
      {group.type === 'start' && group.items.length === 0 && <p className="text-xs text-muted">Trip start</p>}
      <ul className="mt-1.5 space-y-1.5">
        {group.items.map((s) => (
          <li key={s.id} className="flex items-start gap-2">
            <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: STOP_HEX[s.type] }} aria-hidden />
            <span>
              <span className="block text-xs font-medium text-ink">
                {KIND_LABEL[s.kind]} · {fmtDuration(s.duration_hours)}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                {fmtDayTime(s.start)}
                {s.mile > 0 && <MileTag mile={s.mile} />}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Legend({ theme }: { theme: Theme }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {LEGEND_ORDER.map((t) => (
        <li key={t} className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
          <span className="size-2.5 rounded-full ring-2 ring-white" style={{ background: STOP_HEX[t] }} aria-hidden />
          {STOP_META[t].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
        <span className="w-4 border-t-2 border-dashed border-slate-600" aria-hidden /> To pickup
      </li>
      <li className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
        <span className="w-4 border-t-[3px]" style={{ borderColor: ROUTE_COLORS[theme].loaded }} aria-hidden /> Loaded
      </li>
      <li className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
        <span className="size-2.5 rounded-[3px] bg-[var(--color-truck)] ring-2 ring-surface" aria-hidden /> Truck
      </li>
    </ul>
  )
}

export default function RouteMap({ plan, groups, selectedGroupId, onSelectGroup, truckAt = null, theme = 'light' }: Props) {
  const colors = ROUTE_COLORS[theme]
  const markers = useRef(new Map<string, L.Marker>())
  const bounds = useMemo(
    () => L.latLngBounds(plan.route.geometry.map(([a, b]) => [a, b] as [number, number])),
    [plan],
  )
  const legs = plan.route.legs

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative min-h-[300px] w-full flex-1 overflow-hidden rounded-xl">
        <MapContainer
          bounds={bounds}
          scrollWheelZoom={false}
        zoomSnap={0.25}
        zoomDelta={0.5}
          className="absolute inset-0 h-full w-full"
          attributionControl
        >
          {/* OSM tiles, muted with a CSS filter (.leaflet-tile-pane) so the stop colors carry the map */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <FitToRoute bounds={bounds} />
          <FlyToSelected groups={groups} selectedGroupId={selectedGroupId} markers={markers} />
          {legs.map((leg, i) => (
            <Polyline key={`halo-${theme}-${i}`} positions={leg.geometry} pathOptions={{ color: colors.casing, weight: 8, opacity: 0.9 }} />
          ))}
          {legs.map((leg, i) => (
            <Polyline
              key={`leg-${theme}-${i}`}
              positions={leg.geometry}
              pathOptions={{
                color: i === 0 ? colors.deadhead : colors.loaded,
                weight: 4.5,
                opacity: 0.95,
                dashArray: i === 0 ? '8 8' : undefined,
              }}
            >
              <Popup>
                <p className="text-[13px] font-semibold">
                  {leg.from} → {leg.to}
                </p>
                <p className="text-xs text-muted">
                  {fmtMiles(leg.miles)} · {fmtDuration(leg.duration_hours)} driving · {leg.avg_mph} mph avg
                </p>
              </Popup>
            </Polyline>
          ))}
          {/* a dash flowing along the loaded leg shows the direction of travel */}
        {legs.length > 1 && (
          <Polyline
            positions={legs[legs.length - 1].geometry}
            interactive={false}
            key={`flow-${theme}`}
            pathOptions={{ color: colors.flow, weight: 2, opacity: 0.85, dashArray: '2 16', lineCap: 'round', className: 'route-flow' }}
          />
        )}
        {groups.map((g) => (
            <Marker
              key={g.id}
              position={[g.lat, g.lng]}
              icon={stopIcon(g.type, g.items.filter((s) => s.type !== 'inspection').length)}
              zIndexOffset={STOP_META[g.type].priority * 100}
              title={`${STOP_META[g.type].label}: ${g.label}`}
              eventHandlers={{ click: () => onSelectGroup(g.id) }}
              ref={(m) => {
                if (m) markers.current.set(g.id, m)
                else markers.current.delete(g.id)
              }}
            >
              <Popup>
                <GroupPopup group={g} />
              </Popup>
            </Marker>
          ))}
          {truckAt && (
            <Marker position={truckAt} icon={truckIcon} interactive={false} keyboard={false} zIndexOffset={2000} title="Truck position" />
          )}
        </MapContainer>
        {/* Overlay legend from sm up; on phones it sits under the map so it doesn't hide the route. */}
        <div className="pointer-events-none absolute bottom-2 left-2 z-[500] hidden max-w-[calc(100%-1rem)] rounded-lg bg-surface/95 px-3 py-2 shadow-card backdrop-blur-sm sm:block">
          <Legend theme={theme} />
        </div>
      </div>
      <div className="px-1 sm:hidden">
        <Legend theme={theme} />
      </div>
    </div>
  )
}
