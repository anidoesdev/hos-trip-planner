/** Place autocomplete via Photon (komoot), a free OSM-based geocoder that allows browser CORS requests. */

import type { LatLng } from './geo'

export type PlaceKind =
  | 'city'
  | 'town'
  | 'village'
  | 'address'
  | 'street'
  | 'truckstop'
  | 'fuel'
  | 'industrial'
  | 'business'
  | 'airport'
  | 'port'
  | 'region'
  | 'place'

export interface PlaceSuggestion {
  id: string
  /** Text sent to the backend geocoder, e.g. "Joliet, IL" or "40 E Laraway Rd, Joliet, IL". */
  value: string
  /** Main line, e.g. "Pilot Travel Center". */
  primary: string
  /** Where it is, e.g. "40 East Laraway Road, Joliet, IL 60436". */
  secondary: string
  /** County / country context, e.g. "Will County · United States". */
  context: string
  kind: PlaceKind
  kindLabel: string
  coords: LatLng
}

const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  Ontario: 'ON', Quebec: 'QC', 'British Columbia': 'BC', Alberta: 'AB', Manitoba: 'MB', Saskatchewan: 'SK',
}

const KIND_LABEL: Record<PlaceKind, string> = {
  city: 'City',
  town: 'Town',
  village: 'Village',
  address: 'Address',
  street: 'Street',
  truckstop: 'Truck stop',
  fuel: 'Fuel',
  industrial: 'Industrial',
  business: 'Business',
  airport: 'Airport',
  port: 'Port',
  region: 'Region',
  place: 'Place',
}

const NORTH_AMERICA_BBOX = '-170,14,-50,72'

interface PhotonProps {
  osm_id?: number
  osm_type?: string
  osm_key?: string
  osm_value?: string
  type?: string
  name?: string
  housenumber?: string
  street?: string
  city?: string
  district?: string
  county?: string
  state?: string
  countrycode?: string
  postcode?: string
}
interface PhotonFeature {
  properties: PhotonProps
  geometry: { coordinates: [number, number] }
}

function kindOf(p: PhotonProps): PlaceKind {
  const k = p.osm_key ?? ''
  const v = p.osm_value ?? ''
  if (k === 'place') {
    if (v === 'city') return 'city'
    if (v === 'town') return 'town'
    if (['village', 'hamlet', 'suburb', 'neighbourhood', 'locality'].includes(v)) return 'village'
    if (['county', 'state', 'region', 'province'].includes(v)) return 'region'
  }
  if (k === 'boundary') return 'region'
  if (k === 'highway' && (v === 'services' || v === 'rest_area')) return 'truckstop'
  if (k === 'amenity' && v === 'fuel') return 'fuel'
  if (k === 'aeroway') return 'airport'
  if (k === 'harbour' || v === 'port' || v === 'ferry_terminal') return 'port'
  if (k === 'landuse' && v === 'industrial') return 'industrial'
  if (k === 'building' && ['warehouse', 'industrial'].includes(v)) return 'industrial'
  if (k === 'highway') return 'street'
  if (k === 'building' || p.type === 'house' || p.housenumber) return p.name ? 'business' : 'address'
  if (['shop', 'amenity', 'office', 'craft', 'man_made', 'tourism'].includes(k)) return 'business'
  return 'place'
}

const abbr = (state?: string) => (state ? (STATE_ABBR[state] ?? state) : '')

function toSuggestion(f: PhotonFeature): PlaceSuggestion | null {
  const p = f.properties
  const kind = kindOf(p)
  const st = abbr(p.state)
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const isSettlement = kind === 'city' || kind === 'town' || kind === 'village' || kind === 'region'
  const primary = p.name || street
  if (!primary) return null

  // What the backend geocodes: settlements as "City, ST"; everything else with its street and city
  const locality = isSettlement ? '' : (p.city ?? p.district ?? '')
  const value = isSettlement
    ? [primary, st].filter(Boolean).join(', ')
    : [p.name && street ? street : primary, locality, st].filter(Boolean).join(', ')

  const where = isSettlement
    ? [p.county, st].filter(Boolean).join(', ')
    : [p.name ? street : '', locality, [st, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const country = p.countrycode === 'CA' ? 'Canada' : 'United States'
  const context = isSettlement ? country : [p.county, country].filter(Boolean).join(' · ')

  const [lng, lat] = f.geometry.coordinates
  return {
    id: `${p.osm_type}${p.osm_id}`,
    value,
    primary,
    secondary: where || country,
    context,
    kind,
    kindLabel: KIND_LABEL[kind],
    coords: [lat, lng],
  }
}

const cache = new Map<string, PlaceSuggestion[]>()

export async function searchPlaces(query: string, signal: AbortSignal, near?: LatLng | null): Promise<PlaceSuggestion[]> {
  const key = `${query.trim().toLowerCase()}|${near ? near.map((n) => n.toFixed(1)).join(',') : ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '10')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('bbox', NORTH_AMERICA_BBOX)
  if (near) {
    // bias toward the previous stop without excluding far-away matches
    url.searchParams.set('lat', String(near[0]))
    url.searchParams.set('lon', String(near[1]))
    url.searchParams.set('location_bias_scale', '0.2')
  }
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`)
  const data = (await res.json()) as { features?: PhotonFeature[] }
  const seen = new Set<string>()
  const out: PlaceSuggestion[] = []
  for (const f of data.features ?? []) {
    if (f.properties.countrycode && !['US', 'CA'].includes(f.properties.countrycode)) continue
    const s = toSuggestion(f)
    if (!s || seen.has(s.value)) continue
    seen.add(s.value)
    out.push(s)
    if (out.length === 6) break
  }
  cache.set(key, out)
  return out
}

/** "City, ST" for a coordinate (used by "Use my location"). */
export async function reversePlace(coords: LatLng, signal?: AbortSignal): Promise<PlaceSuggestion | null> {
  const url = new URL('https://photon.komoot.io/reverse')
  url.searchParams.set('lat', String(coords[0]))
  url.searchParams.set('lon', String(coords[1]))
  url.searchParams.set('lang', 'en')
  url.searchParams.set('limit', '1')
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`)
  const data = (await res.json()) as { features?: PhotonFeature[] }
  const f = data.features?.[0]
  if (!f) return null
  const p = f.properties
  const city = p.city ?? p.district ?? p.name
  const st = abbr(p.state)
  if (!city) return null
  return {
    id: `me-${coords.join(',')}`,
    value: [city, st].filter(Boolean).join(', '),
    primary: [city, st].filter(Boolean).join(', '),
    secondary: 'Your current location',
    context: p.county ?? '',
    kind: 'city',
    kindLabel: 'You are here',
    coords,
  }
}

// ---- recent places (per browser) -----------------------------------------------------------
const RECENT_KEY = 'hos.recentPlaces'

export function loadRecent(): PlaceSuggestion[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as PlaceSuggestion[]).slice(0, 5) : []
  } catch {
    return []
  }
}

export function rememberPlace(s: PlaceSuggestion): void {
  try {
    const next = [s, ...loadRecent().filter((r) => r.value !== s.value)].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
}
