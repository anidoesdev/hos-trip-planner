import { cx } from '../ui/primitives'

interface Props {
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}

/** 70-hour/8-day cycle hours already used: a slider and a number box kept in sync. */
export function CycleInput({ value, onChange, error, disabled }: Props) {
  const n = Number(value)
  const valid = value !== '' && Number.isFinite(n) && n >= 0 && n <= 70
  const used = valid ? n : 0
  const pct = (used / 70) * 100
  const tone = used >= 60 ? 'var(--color-danger)' : used >= 45 ? 'var(--color-accent)' : 'var(--color-ink)'

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor="cycle" className="text-[13px] font-medium text-ink-soft">
          Hours already used <span className="font-normal text-muted">(70-hr cycle)</span>
        </label>
        <span className="tabular text-xs text-muted">
          {valid ? `${(70 - n).toFixed(n % 1 ? 2 : 0)} h left` : '—'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={70}
          step={0.25}
          value={used}
          disabled={disabled}
          aria-label="Current cycle used, hours (slider)"
          onChange={(e) => onChange(e.target.value)}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-ink"
          style={{ background: `linear-gradient(to right, ${tone} ${pct}%, var(--color-line) ${pct}%)` }}
        />
        <div className="relative">
          <input
            id="cycle"
            type="number"
            inputMode="decimal"
            min={0}
            max={70}
            step={0.25}
            value={value}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? 'cycle-error' : undefined}
            onChange={(e) => onChange(e.target.value)}
            className={cx(
              'tabular h-11 w-24 rounded-lg border bg-surface pl-3 pr-7 text-right text-[15px] font-medium',
              'focus:outline-none focus:ring-2 focus:ring-accent/30',
              error ? 'border-danger' : 'border-line-strong focus:border-ink/50',
            )}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">h</span>
        </div>
      </div>
      {!error && (
        <p className="mt-1 text-xs text-muted">
          On-duty hours in the last 8 days. Use 0 for a fully rested driver.
        </p>
      )}
      {error && (
        <p id="cycle-error" className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
