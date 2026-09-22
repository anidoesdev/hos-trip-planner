import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import { useDebounced } from '../../hooks/useDebounced'
import { searchPlaces, type PlaceSuggestion } from '../../lib/photon'
import { cx } from '../ui/primitives'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
  markerColor: string
  disabled?: boolean
}

/** Text input with debounced Photon autocomplete, implemented as an ARIA 1.2 combobox. */
export function LocationInput({ id, label, value, onChange, placeholder, error, markerColor, disabled }: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<PlaceSuggestion[]>([])
  const [typed, setTyped] = useState(false) // only search after the user types, not after a preset/selection
  const query = useDebounced(value, 280)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!typed || query.trim().length < 3) {
      setItems([])
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    searchPlaces(query, ctrl.signal)
      .then((res) => {
        setItems(res)
        setActive(-1)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setItems([])
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [query, typed])

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [])

  const choose = (s: PlaceSuggestion) => {
    onChange(s.value)
    setTyped(false)
    setItems([])
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      choose(items[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && typed && (items.length > 0 || loading)

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
          <MapPin className="size-3 text-white" strokeWidth={2.5} />
        </span>
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value)
            setTyped(true)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cx(
            'h-11 w-full rounded-lg border bg-surface pl-11 pr-9 text-[15px] text-ink placeholder:text-muted/70 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-accent/30',
            error ? 'border-danger focus:border-danger' : 'border-line-strong focus:border-ink/50',
            disabled && 'opacity-60',
          )}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-card"
        >
          {items.length === 0 && loading && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {items.map((s, i) => (
            <li
              key={s.id + i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault()
                choose(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={cx('cursor-pointer px-3 py-2', i === active ? 'bg-paper' : '')}
            >
              <div className="text-sm font-medium text-ink">{s.primary}</div>
              <div className="text-xs text-muted">{s.secondary}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
