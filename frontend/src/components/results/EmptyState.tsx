import { ClipboardList, Map as MapIcon, ShieldCheck } from 'lucide-react'
import { Card } from '../ui/primitives'

/** A small, decorative log grid with a duty line, so the empty state previews the output. */
function MiniLog() {
  const d = 'M0 12H60V60H200V84H290V60H330V36H420'
  return (
    <svg viewBox="-4 0 428 100" className="h-auto w-full" aria-hidden>
      {[0, 24, 48, 72, 96].map((y) => (
        <line key={y} x1={0} x2={420} y1={y} y2={y} stroke="var(--color-line-strong)" />
      ))}
      {Array.from({ length: 25 }, (_, i) => (
        <line key={i} x1={i * 17.5} x2={i * 17.5} y1={0} y2={96} stroke="var(--color-line)" />
      ))}
      <path d={d} fill="none" stroke="var(--color-pen)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const POINTS = [
  { icon: MapIcon, title: 'Truck route & stops', text: 'Fuel every ≤1,000 mi, 30-min breaks, 10-hr rests and 34-hr restarts placed on the map.' },
  { icon: ShieldCheck, title: 'FMCSA HOS rules', text: '11-hr driving, 14-hr window, 8-hr break rule and the 70-hr/8-day cycle (49 CFR §395.3).' },
  { icon: ClipboardList, title: 'Daily log sheets', text: 'One filled-in Driver’s Daily Log per day, ready to print or download as PDF.' },
]

export function EmptyState() {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-paper/60 px-6 pb-5 pt-6 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-strong">Dispatch preview</p>
        <h2 className="mt-1 max-w-lg text-2xl font-semibold tracking-tight text-ink sm:text-[28px] sm:leading-tight">
          Enter a trip to get a compliant route and ready-to-sign daily logs.
        </h2>
        <div className="mt-6 rounded-lg border border-line bg-surface p-3 sm:p-4">
          <MiniLog />
        </div>
      </div>
      <ul className="grid gap-5 px-6 py-6 sm:grid-cols-3 sm:px-8">
        {POINTS.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <Icon className="size-5 text-accent" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-ink">{title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{text}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
