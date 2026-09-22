/** Place autocomplete via Photon (komoot), a free OSM-based geocoder that allows browser CORS requests. */

export interface PlaceSuggestion {
  id: string
  /** Text sent to the backend geocoder, e.g. "Joliet, IL" or "1200 W Main St, Joliet, IL". */
  value: string
  primary: string
  secondary: string
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

const PLACE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'borough', 'suburb'])
const NORTH_AMERICA_BBOX = '-170,14,-50,72'

interface PhotonProps {
  osm_id?: number
  osm_type?: string
  osm_value?: string
  name?: string
  housenumber?: string
  street?: string
  city?: string
  state?: string
  countrycode?: string
  postcode?: string
}

const cache = new Map<string, PlaceSuggestion[]>()

function toSuggestion(p: PhotonProps): PlaceSuggestion | null {
  const st = p.state ? (STATE_ABBR[p.state] ?? p.state) : ''
  const isPlace = PLACE_TYPES.has(p.osm_value ?? '')
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const primary = isPlace ? (p.name ?? '') : p.name || street
  if (!primary) return null
  const locality = isPlace ? '' : (p.city ?? '')
  const secondary = [locality, st, p.countrycode === 'CA' ? 'Canada' : ''].filter(Boolean).join(', ')
  const value = [primary, locality, st].filter(Boolean).join(', ')
  return { id: `${p.osm_type}${p.osm_id}`, value, primary, secondary: secondary || 'United States' }
}

export async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const key = query.trim().toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '8')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('bbox', NORTH_AMERICA_BBOX)
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`)
  const data = (await res.json()) as { features?: { properties: PhotonProps }[] }
  const seen = new Set<string>()
  const out: PlaceSuggestion[] = []
  for (const f of data.features ?? []) {
    const p = f.properties
    if (p.countrycode && !['US', 'CA'].includes(p.countrycode)) continue
    const s = toSuggestion(p)
    if (!s || seen.has(s.value)) continue
    seen.add(s.value)
    out.push(s)
    if (out.length === 6) break
  }
  cache.set(key, out)
  return out
}
