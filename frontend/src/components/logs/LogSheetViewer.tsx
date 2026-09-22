import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react'
import type { TripPlan } from '../../api/types'
import { fmtDay, fmtHours, fmtLongDay } from '../../lib/format'
import { Button, Card, ComplianceBadge, SectionHeading, cx } from '../ui/primitives'
import { CarrierDetailsForm } from './CarrierDetailsForm'
import { DailyLogSheet, type CarrierDetails } from './DailyLogSheet'

interface Props {
  plan: TripPlan
  details: CarrierDetails
  onDetailsChange: (d: CarrierDetails) => void
}

/** Recap column C: on-duty hours over the last 5 log days of this trip, including today. */
function last5Totals(plan: TripPlan): number[] {
  const onDuty = plan.daily_logs.map((d) => d.recap.on_duty_today)
  return onDuty.map((_, i) => onDuty.slice(Math.max(0, i - 4), i + 1).reduce((a, b) => a + b, 0))
}

export function LogSheetViewer({ plan, details, onDetailsChange }: Props) {
  const logs = plan.daily_logs
  const [index, setIndex] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const printRef = useRef<HTMLDivElement>(null)
  const last5 = useMemo(() => last5Totals(plan), [plan])
  const day = logs[Math.min(index, logs.length - 1)]
  const ok = day.compliance?.ok ?? plan.compliance.ok

  const downloadPdf = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const { downloadLogsPdf } = await import('./exportPdf')
      const svgs = Array.from(printRef.current?.querySelectorAll('svg') ?? [])
      await downloadLogsPdf(svgs, `daily-logs-${logs[0].date}.pdf`)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'PDF export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section aria-labelledby="logs-heading" className="space-y-4">
      <SectionHeading
        eyebrow="Record of duty status"
        title={<span id="logs-heading">Driver&apos;s daily logs</span>}
        action={
          <div className="flex gap-2">
            <Button size="sm" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>
              Print
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={exporting}
              icon={<Download className="size-4" aria-hidden />}
              onClick={downloadPdf}
            >
              Download PDF
            </Button>
          </div>
        }
      />
      {exportError && <p className="text-sm text-danger">{exportError}</p>}

      <CarrierDetailsForm value={details} onChange={onDetailsChange} />

      <Card className="overflow-hidden">
        {/* day tabs */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous day"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
            className="px-2"
            icon={<ChevronLeft className="size-4" aria-hidden />}
          />
          <div role="tablist" aria-label="Log days" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
            {logs.map((d, i) => {
              const dayOk = d.compliance?.ok ?? plan.compliance.ok
              return (
                <button
                  key={d.date}
                  role="tab"
                  aria-selected={i === index}
                  aria-controls="log-sheet-panel"
                  onClick={() => setIndex(i)}
                  className={cx(
                    'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors',
                    i === index ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper',
                  )}
                >
                  <span className={cx('size-1.5 rounded-full', dayOk ? 'bg-emerald-500' : 'bg-red-500')} aria-hidden />
                  <span className="text-[13px] font-medium">Day {d.day_number}</span>
                  <span className={cx('hidden text-xs sm:inline', i === index ? 'text-white/70' : 'text-muted')}>
                    {fmtDay(d.date)}
                  </span>
                </button>
              )
            })}
          </div>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next day"
            disabled={index === logs.length - 1}
            onClick={() => setIndex((i) => i + 1)}
            className="px-2"
            icon={<ChevronRight className="size-4" aria-hidden />}
          />
        </div>

        {/* per-day facts */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line bg-paper/50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">
              Day {day.day_number} of {logs.length}
              <span className="font-normal text-muted"> · {fmtLongDay(day.date)}</span>
            </p>
            <p className="text-xs text-muted">
              {day.from_location} → {day.to_location}
            </p>
          </div>
          <dl className="tabular flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <Fact label="Driving" value={`${fmtHours(day.totals_hours.D)} h`} />
            <Fact label="On duty" value={`${fmtHours(day.recap.on_duty_today)} h`} />
            <Fact label="Miles" value={Math.round(day.total_miles_driving_today).toLocaleString('en-US')} />
            <Fact label="Total" value={`${fmtHours(day.total_hours)} h`} />
          </dl>
          <ComplianceBadge
            ok={ok}
            title={
              ok
                ? 'Checked against §395.3: 11-hr, 14-hr, 30-min break, 70-hr/8-day'
                : day.compliance?.violations.map((v) => `${v.cfr} ${v.message}`).join('\n')
            }
          />
        </div>

        <div id="log-sheet-panel" role="tabpanel" className="overflow-x-auto bg-[#e9e7e1] p-3 sm:p-6">
          <div className="mx-auto min-w-[640px] max-w-[980px] shadow-sheet">
            <DailyLogSheet log={day} details={details} last5Hours={last5[index]} className="block h-auto w-full" />
          </div>
        </div>
        {!ok && day.compliance && (
          <ul className="border-t border-line bg-danger-soft/40 px-4 py-3 text-sm text-danger">
            {day.compliance.violations.map((v, i) => (
              <li key={i}>
                {v.cfr} — {v.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Every sheet, one per page, for Print and PDF export. Hidden on screen. */}
      {createPortal(
        <div ref={printRef} className="hidden print:block" aria-hidden>
          {logs.map((d, i) => (
            <div key={d.date} className="print-sheet">
              <DailyLogSheet log={d} details={details} last5Hours={last5[i]} className="block h-auto w-full" />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  )
}
