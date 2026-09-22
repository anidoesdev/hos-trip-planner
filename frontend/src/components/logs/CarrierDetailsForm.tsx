import { ChevronDown, Truck } from 'lucide-react'
import type { CarrierDetails } from './DailyLogSheet'

const FIELDS: { key: keyof CarrierDetails; label: string; placeholder: string }[] = [
  { key: 'carrier', label: 'Carrier name', placeholder: 'e.g. Acme Freight LLC' },
  { key: 'mainOffice', label: 'Main office address', placeholder: 'City, ST' },
  { key: 'homeTerminal', label: 'Home terminal address', placeholder: 'City, ST' },
  { key: 'truck', label: 'Truck / trailer numbers', placeholder: 'Tractor 1042 / Trailer 5580 (IL)' },
  { key: 'manifest', label: 'DVL / manifest no.', placeholder: 'BOL-000142' },
  { key: 'shipper', label: 'Shipper & commodity', placeholder: 'Shipper — general freight' },
]

interface Props {
  value: CarrierDetails
  onChange: (value: CarrierDetails) => void
}

/** Header details that are the same on every sheet. Stored in localStorage between visits. */
export function CarrierDetailsForm({ value, onChange }: Props) {
  const filled = FIELDS.filter((f) => value[f.key].trim()).length
  return (
    <details className="group rounded-xl border border-line bg-paper/60 open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <Truck className="size-4 text-muted" aria-hidden />
          Carrier &amp; vehicle details
          <span className="tabular rounded-full bg-line px-2 py-0.5 text-[11px] font-medium text-ink-soft">
            {filled}/{FIELDS.length}
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs text-muted">
          <span className="hidden sm:inline">Fills every sheet</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <div className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">{f.label}</span>
            <input
              type="text"
              value={value[f.key]}
              placeholder={f.placeholder}
              maxLength={60}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
              className="h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm placeholder:text-muted/60 focus:border-ink/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
        ))}
      </div>
    </details>
  )
}
