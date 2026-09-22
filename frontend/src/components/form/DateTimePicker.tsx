import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Moon, RotateCcw, Sunrise, Zap } from 'lucide-react'
import { defaultStartLocal } from '../../lib/format'
import { Button, cx } from '../ui/primitives'

/** Value format matches <input type="datetime-local">: "YYYY-MM-DDTHH:MM" (home-terminal wall clock). */
interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const toValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const parse = (v: string) => (v ? new Date(`${v}:00`) : new Date())
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const fmtTrigger = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const fmtMonth = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const fmtLong = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

/** "in 7 h", "in 2 days", "3 h ago" */
function relative(d: Date, now = new Date()): string {
  const min = Math.round((d.getTime() - now.getTime()) / 60_000)
  const abs = Math.abs(min)
  const text = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`
  if (abs < 2) return 'now'
  return min > 0 ? `in ${text}` : `${text} ago`
}

/** 42 cells (6 weeks) starting on the Sunday on or before the 1st of the month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

const SLOTS = Array.from({ length: 96 }, (_, i) => ({ h: Math.floor(i / 4), m: (i % 4) * 15 }))

export function DateTimePicker({ id, value, onChange, disabled }: Props) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const selected = parse(value)
  const [view, setView] = useState({ y: selected.getFullYear(), m: selected.getMonth() })
  const [focusDay, setFocusDay] = useState(selected)
  const wrapRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const today = new Date()
  const days = useMemo(() => monthGrid(view.y, view.m), [view])

  // open: sync the view to the selection and scroll the time list to the chosen slot
  useEffect(() => {
    if (!open) return
    const d = parse(value)
    setView({ y: d.getFullYear(), m: d.getMonth() })
    setFocusDay(d)
    requestAnimationFrame(() => {
      slotsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
    })
  }, [open]) // only when the panel opens, not on every value change

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  const setDate = (d: Date) => {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), selected.getHours(), selected.getMinutes())
    onChange(toValue(next))
    setFocusDay(next)
  }
  const setTime = (h: number, m: number) => {
    onChange(toValue(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), h, m)))
  }

  const presets = [
    { label: 'Now', icon: Zap, make: () => {
      const d = new Date()
      d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
      return d
    } },
    { label: 'Next 6:00 AM', icon: Sunrise, make: () => parse(defaultStartLocal()) },
    { label: 'Tonight 10:00 PM', icon: Moon, make: () => {
      const d = new Date()
      d.setHours(22, 0, 0, 0)
      if (d < new Date()) d.setDate(d.getDate() + 1)
      return d
    } },
  ]

  const moveFocus = (deltaDays: number) => {
    const d = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + deltaDays)
    setFocusDay(d)
    if (d.getMonth() !== view.m || d.getFullYear() !== view.y) setView({ y: d.getFullYear(), m: d.getMonth() })
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus())
  }

  const onGridKey = (e: KeyboardEvent) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (delta !== undefined) {
      e.preventDefault()
      moveFocus(delta)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setDate(focusDay)
    }
  }

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
        <CalendarClock className="size-3.5" aria-hidden /> Start date &amp; time
        <span className="font-normal text-muted">(optional)</span>
      </label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex h-11 w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 text-left transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-accent/30',
          open ? 'border-ink/50' : 'border-line-strong hover:border-ink/30',
          disabled && 'opacity-60',
        )}
      >
        <span className="num text-[15px] font-medium text-ink">
          {fmtTrigger.format(selected)} <span className="text-muted">·</span> {fmtTime.format(selected)}
        </span>
        <span className="shrink-0 rounded-md bg-paper px-1.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line">
          {relative(selected)}
        </span>
      </button>
      <p className="mt-1 text-xs text-muted">Home-terminal time. The log for day 1 starts at midnight, off duty.</p>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose start date and time"
          onKeyDown={onPanelKey}
          className="absolute z-[1100] mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-card sm:w-[26rem]"
        >
          {/* quick presets */}
          <div className="flex flex-wrap gap-1.5 border-b border-line p-2.5">
            {presets.map(({ label, icon: Icon, make }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  const d = make()
                  onChange(toValue(d))
                  setView({ y: d.getFullYear(), m: d.getMonth() })
                  setFocusDay(d)
                }}
                className="flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-ink"
              >
                <Icon className="size-3.5 text-accent-strong" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_7.5rem]">
            {/* calendar */}
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
                  className="flex size-8 items-center justify-center rounded-md text-ink-soft hover:bg-paper hover:text-ink"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <p className="text-sm font-semibold text-ink" aria-live="polite">
                  {fmtMonth.format(new Date(view.y, view.m, 1))}
                </p>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
                  className="flex size-8 items-center justify-center rounded-md text-ink-soft hover:bg-paper hover:text-ink"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
              <div className="grid grid-cols-7 text-center text-[10.5px] font-semibold uppercase tracking-wide text-muted" aria-hidden>
                {WEEKDAYS.map((d) => (
                  <span key={d} className="py-1">
                    {d}
                  </span>
                ))}
              </div>
              <div ref={gridRef} role="grid" aria-label="Start date" onKeyDown={onGridKey} className="space-y-0.5">
                {[0, 1, 2, 3, 4, 5].map((w) => (
                  <div key={w} role="row" className="grid grid-cols-7 gap-0.5">
                    {days.slice(w * 7, w * 7 + 7).map((d) => {
                      const inMonth = d.getMonth() === view.m
                      const isSel = sameDay(d, selected)
                      const isToday = sameDay(d, today)
                      const isFocus = sameDay(d, focusDay)
                      return (
                        <button
                          key={d.toISOString()}
                          type="button"
                          role="gridcell"
                          tabIndex={isFocus ? 0 : -1}
                          aria-selected={isSel}
                          aria-label={`${fmtLong.format(d)}${isToday ? ' (today)' : ''}`}
                          onClick={() => setDate(d)}
                          className={cx(
                            'num relative flex h-9 items-center justify-center rounded-md text-[13px] transition-colors',
                            isSel
                              ? 'glow bg-primary font-bold text-on-primary'
                              : inMonth
                                ? 'text-ink hover:bg-paper'
                                : 'font-normal text-muted hover:bg-paper',
                            isToday && !isSel && 'font-bold ring-1 ring-accent',
                          )}
                        >
                          {d.getDate()}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* time slots */}
            <div className="border-t border-line sm:border-l sm:border-t-0">
              <p className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted">Time</p>
              <div ref={slotsRef} role="listbox" aria-label="Start time" className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto px-2 pb-3 sm:max-h-[17.5rem] sm:grid-cols-1">
                {SLOTS.map(({ h, m }) => {
                  const isSel = selected.getHours() === h && selected.getMinutes() === m
                  const label = fmtTime.format(new Date(2000, 0, 1, h, m))
                  return (
                    <button
                      key={`${h}:${m}`}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      onClick={() => setTime(h, m)}
                      className={cx(
                        'num rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
                        isSel ? 'glow bg-primary font-bold text-on-primary' : 'text-ink-soft hover:bg-paper hover:text-ink',
                        m !== 0 && !isSel && 'text-muted',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line bg-paper/60 px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" aria-hidden />}
              onClick={() => onChange(defaultStartLocal())}
            >
              Reset
            </Button>
            <Button size="sm" variant="primary" onClick={() => { setOpen(false); triggerRef.current?.focus() }}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
