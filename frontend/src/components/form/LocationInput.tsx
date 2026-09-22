import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Anchor,
  Building,
  Building2,
  Fuel,
  History,
  House,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Plane,
  Route,
  SearchX,
  Store,
  Truck,
  Warehouse,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useDebounced } from '../../hooks/useDebounced'
import { haversineMiles, type LatLng } from '../../lib/geo'
import { loadRecent, rememberPlace, reversePlace, searchPlaces, type PlaceKind, type PlaceSuggestion } from '../../lib/photon'
import { cx } from '../ui/primitives'

const KIND_ICON: Record<PlaceKind, LucideIcon> = {
  city: Building2,
  town: Building,
  village: House,
  address: MapPin,
  street: Route,
  truckstop: Truck,
  fuel: Fuel,
  industrial: Warehouse,
  business: Store,
  airport: Plane,
  port: Anchor,
  region: MapIcon,
  place: MapPin,
}

export interface PickedPlace {
  label: string
  coords: LatLng
}

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  /** Called when the user picks a suggestion (gives the next field a reference point). */
  onPick?: (place: PickedPlace | null) => void
  /** Previous stop: suggestions show their straight-line distance from it and are biased toward it. */
  reference?: PickedPlace | null
  /** Offer "Use my current location" (the Current location field). */
  allowGeolocate?: boolean
  placeholder?: string
  error?: string
  markerColor: string
  /** Icon color on the marker badge (defaults to white). */
  markerIconColor?: string
  disabled?: boolean
}

type Option =
  | { key: string; type: 'geo' }
  | { key: string; type: 'recent'; s: PlaceSuggestion }
  | { key: string; type: 'result'; s: PlaceSuggestion }

/** Bold the parts of `text` that match any word of the query. */
function highlight(text: string, query: string): ReactNode {
  const words = query.trim().split(/[\s,]+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return text
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'ig'))
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-transparent font-semibold text-accent-strong">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

function fmtDistance(mi: number) {
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi).toLocaleString('en-US')} mi`
}

/** Text input with debounced Photon autocomplete, implemented as an ARIA 1.2 combobox. */
export function LocationInput({
  id,
  label,
  value,
  onChange,
  onPick,
  reference = null,
  allowGeolocate = false,
  placeholder,
  error,
  markerColor,
  markerIconColor = '#fff',
  disabled,
}: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [results, setResults] = useState<PlaceSuggestion[]>([])
  const [recent, setRecent] = useState<PlaceSuggestion[]>([])
  const [typed, setTyped] = useState(false) // only search after the user types, not after a preset/selection
  const [locating, setLocating] = useState<'idle' | 'busy' | 'error'>('idle')
  const query = useDebounced(value, 250)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searching = typed && value.trim().length >= 3

  useEffect(() => {
    if (!typed || query.trim().length < 3) {
      setResults([])
      setFailed(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setFailed(false)
    searchPlaces(query, ctrl.signal, reference?.coords)
      .then((res) => {
        setResults(res)
        setActive(res.length ? 0 : -1)
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setResults([])
        setFailed(true)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [query, typed, reference])

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [])

  const options: Option[] = useMemo(() => {
    if (searching) return results.map((s) => ({ key: `r-${s.id}`, type: 'result' as const, s }))
    const out: Option[] = []
    if (allowGeolocate && 'geolocation' in navigator) out.push({ key: 'geo', type: 'geo' })
    for (const s of recent.filter((r) => r.value !== value)) out.push({ key: `h-${s.value}`, type: 'recent', s })
    return out
  }, [searching, results, recent, allowGeolocate, value])

  const choose = (s: PlaceSuggestion) => {
    onChange(s.value)
    onPick?.({ label: s.value, coords: s.coords })
    rememberPlace(s)
    setTyped(false)
    setResults([])
    setOpen(false)
  }

  const geolocate = () => {
    setLocating('busy')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        reversePlace([pos.coords.latitude, pos.coords.longitude])
          .then((s) => {
            if (!s) throw new Error('no place')
            setLocating('idle')
            choose(s)
          })
          .catch(() => setLocating('error'))
      },
      () => setLocating('error'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  const activate = (o: Option) => (o.type === 'geo' ? geolocate() : choose(o.s))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (!options.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1))
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault()
      activate(options[active])
    }
  }

  const showPanel = open && !disabled && (searching || options.length > 0 || locating !== 'idle')
  const activeId = showPanel && active >= 0 && options[active] ? `${listId}-${options[active].key}` : undefined

  const row = (o: Option, i: number) => {
    const selected = i === active
    const base = cx('flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors', selected && 'bg-accent-soft/60')
    const common = {
      id: `${listId}-${o.key}`,
      role: 'option' as const,
      'aria-selected': selected,
      onMouseEnter: () => setActive(i),
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault()
        activate(o)
      },
      className: base,
    }
    if (o.type === 'geo') {
      return (
        <li key={o.key} {...common}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
            {locating === 'busy' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LocateFixed className="size-4" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              {locating === 'busy' ? 'Finding your location…' : 'Use my current location'}
            </span>
            <span className={cx('block text-xs', locating === 'error' ? 'text-danger' : 'text-muted')}>
              {locating === 'error' ? 'Location unavailable. Allow access or type the place.' : 'Fills in the nearest city from your device'}
            </span>
          </span>
        </li>
      )
    }
    const s = o.s
    const Icon = o.type === 'recent' ? History : KIND_ICON[s.kind]
    const dist = reference ? haversineMiles(reference.coords, s.coords) : null
    return (
      <li key={o.key} {...common}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper text-ink-soft ring-1 ring-line">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{o.type === 'result' ? highlight(s.primary, value) : s.primary}</span>
            <span className="hidden shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-line-strong sm:inline">
              {o.type === 'recent' ? 'Recent' : s.kindLabel}
            </span>
          </span>
          <span className="block truncate text-xs text-ink-soft">{s.secondary}</span>
          {/* on phones the type chip moves down here so the name keeps the full width */}
          <span className="block truncate text-[11px] text-muted">
            <span className="font-semibold uppercase tracking-wide sm:hidden">{o.type === 'recent' ? 'Recent' : s.kindLabel}</span>
            {s.context && <span className="before:content-['_·_'] sm:before:content-none">{s.context}</span>}
          </span>
        </span>
        {dist !== null && (
          <span className="shrink-0 text-right" title={`Straight-line distance from ${reference!.label}`}>
            <span className="num block text-xs font-bold text-ink">≈ {fmtDistance(dist)}</span>
            <span className="block max-w-24 truncate text-[10px] text-muted">from {reference!.label.split(',')[0]}</span>
          </span>
        )}
      </li>
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ background: markerColor }}
          aria-hidden
        >
          <MapPin className="size-3" style={{ color: markerIconColor }} strokeWidth={2.5} />
        </span>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value)
            onPick?.(null)
            setTyped(true)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => {
            setRecent(loadRecent())
            setLocating('idle')
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className={cx(
            'h-11 w-full rounded-lg border bg-surface pl-11 pr-9 text-[15px] text-ink placeholder:text-muted/70 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-accent/30',
            error ? 'border-danger focus:border-danger' : 'border-line-strong focus:border-ink/50',
            disabled && 'opacity-60',
          )}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />
        ) : (
          value &&
          !disabled && (
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => {
                onChange('')
                onPick?.(null)
                setTyped(false)
                inputRef.current?.focus()
              }}
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      {showPanel && (
        <div className="absolute z-[1100] mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-card sm:w-[calc(100%+4rem)] sm:max-w-[26rem]">
          {!searching && options.some((o) => o.type === 'recent') && (
            <p className="border-b border-line px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              {allowGeolocate ? 'Quick picks' : 'Recent places'}
            </p>
          )}
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="max-h-80 overflow-auto py-1">
            {searching && loading && results.length === 0 &&
              [0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2.5" aria-hidden>
                  <span className="size-8 animate-pulse rounded-lg bg-line" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-3 w-2/3 animate-pulse rounded bg-line" />
                    <span className="block h-2.5 w-1/2 animate-pulse rounded bg-line/70" />
                  </span>
                </li>
              ))}
            {options.map(row)}
          </ul>
          {searching && !loading && results.length === 0 && (
            <div className="flex items-start gap-3 px-3 pb-3 pt-1 text-sm">
              {failed ? (
                <WifiOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              ) : (
                <SearchX className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              )}
              <p className="text-muted">
                {failed ? (
                  'Suggestions are unavailable right now. Type the place and plan anyway; the planner looks it up too.'
                ) : (
                  <>
                    No matches for <span className="font-medium text-ink">“{value.trim()}”</span>. Try adding a state,
                    e.g. “Springfield, IL”.
                  </>
                )}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-line bg-paper/60 px-3 py-1.5 text-[10.5px] text-muted">
            <span className="hidden sm:inline">↑↓ navigate · Enter select · Esc close</span>
            <span>
              {searching ? 'Cities, addresses, truck stops, warehouses' : 'Type 3+ letters to search'} · Photon / OSM
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
