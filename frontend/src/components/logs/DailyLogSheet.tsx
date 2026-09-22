import { memo, type ReactNode } from 'react'
import type { DailyLog, DutyStatus } from '../../api/types'
import { dateParts } from '../../lib/format'
import { buildRemarkStops, minuteToClock, spreadAnchors, truncate } from './remarksLayout'

export interface CarrierDetails {
  carrier: string
  mainOffice: string
  homeTerminal: string
  truck: string
  manifest: string
  shipper: string
}

export const EMPTY_DETAILS: CarrierDetails = {
  carrier: '',
  mainOffice: '',
  homeTerminal: '',
  truck: '',
  manifest: '',
  shipper: '',
}

// ---- geometry (SVG user units) --------------------------------------------------------
const W = 1100
const H = 1180
const GX0 = 160 // midnight
const HOUR = 36
const GX1 = GX0 + 24 * HOUR // next midnight (1024)
const BAND_Y = 318
const BAND_H = 34
const ROW_Y0 = BAND_Y + BAND_H // top of row 1
const ROW_H = 42
const GRID_Y1 = ROW_Y0 + 4 * ROW_H // bottom of row 4
const TOTAL_X = 1072
const ROWS: { status: DutyStatus; label: string[] }[] = [
  { status: 'OFF', label: ['1. Off Duty'] },
  { status: 'SB', label: ['2. Sleeper', 'Berth'] },
  { status: 'D', label: ['3. Driving'] },
  { status: 'ON', label: ['4. On Duty', '(not driving)'] },
]
const ROW_INDEX: Record<DutyStatus, number> = { OFF: 0, SB: 1, D: 2, ON: 3 }

const PRINT_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const PEN_FONT = "Caveat, 'Segoe Print', cursive"
const INK = '#111111'
const PEN = '#1e3a8a'

const xAt = (minute: number) => GX0 + (minute / 60) * HOUR
const rowMid = (s: DutyStatus) => ROW_Y0 + ROW_INDEX[s] * ROW_H + ROW_H / 2

// ---- small drawing helpers --------------------------------------------------------------
function T({
  x,
  y,
  children,
  size = 12,
  weight = 400,
  anchor = 'start',
  fill = INK,
}: {
  x: number
  y: number
  children: ReactNode
  size?: number
  weight?: number
  anchor?: 'start' | 'middle' | 'end'
  fill?: string
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} textAnchor={anchor} fill={fill} fontFamily={PRINT_FONT}>
      {children}
    </text>
  )
}

function Pen({ x, y, children, size = 24, anchor = 'start' }: {
  x: number
  y: number
  children: ReactNode
  size?: number
  anchor?: 'start' | 'middle' | 'end'
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={500} textAnchor={anchor} fill={PEN} fontFamily={PEN_FONT}>
      {children}
    </text>
  )
}

function Blank({ x1, x2, y, value, label, labelLines, size = 22 }: {
  x1: number
  x2: number
  y: number
  value?: string
  label?: string
  labelLines?: string[]
  size?: number
}) {
  const mid = (x1 + x2) / 2
  const lines = labelLines ?? (label ? [label] : [])
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={INK} strokeWidth={1} />
      {value && <Pen x={mid} y={y - 5} size={size} anchor="middle">{truncate(value, 44)}</Pen>}
      {lines.map((l, i) => (
        <T key={i} x={mid} y={y + 15 + i * 14} size={11} anchor="middle">
          {l}
        </T>
      ))}
    </g>
  )
}

// ---- sections ------------------------------------------------------------------------------
function Header({ log, details }: { log: DailyLog; details: CarrierDetails }) {
  const { month, day, year } = dateParts(log.date)
  const miles = Math.round(log.total_miles_driving_today).toLocaleString('en-US')
  return (
    <g>
      <T x={40} y={56} size={30} weight={700}>Drivers Daily Log</T>
      <T x={98} y={76} size={12}>(24 hours)</T>

      {/* date: month / day / year */}
      <Blank x1={330} x2={410} y={56} value={month} label="(month)" size={28} />
      <T x={420} y={56} size={22}>/</T>
      <Blank x1={434} x2={514} y={56} value={day} label="(day)" size={28} />
      <T x={524} y={56} size={22}>/</T>
      <Blank x1={538} x2={638} y={56} value={year} label="(year)" size={28} />

      <T x={680} y={40} size={11.5}>Original - File at home terminal.</T>
      <T x={680} y={57} size={11.5}>Duplicate - Driver retains in his/her possession for 8 days.</T>

      {/* From / To */}
      <T x={40} y={122} size={15} weight={700}>From:</T>
      <line x1={92} x2={500} y1={124} y2={124} stroke={INK} />
      {log.from_location && <Pen x={100} y={118} size={25}>{truncate(log.from_location, 34)}</Pen>}
      <T x={560} y={122} size={15} weight={700}>To:</T>
      <line x1={592} x2={1060} y1={124} y2={124} stroke={INK} />
      {log.to_location && <Pen x={600} y={118} size={25}>{truncate(log.to_location, 38)}</Pen>}

      {/* mileage boxes */}
      <rect x={40} y={148} width={200} height={50} fill="none" stroke={INK} strokeWidth={1.4} />
      <Pen x={140} y={183} size={30} anchor="middle">{miles}</Pen>
      <T x={140} y={214} size={11} anchor="middle">Total Miles Driving Today</T>
      <rect x={260} y={148} width={200} height={50} fill="none" stroke={INK} strokeWidth={1.4} />
      <Pen x={360} y={183} size={30} anchor="middle">{miles}</Pen>
      <T x={360} y={214} size={11} anchor="middle">Total Mileage Today</T>

      {/* truck / trailer */}
      <Blank
        x1={40}
        x2={460}
        y={268}
        value={details.truck}
        labelLines={['Truck/Tractor and Trailer Numbers or', 'License Plate(s)/State (show each unit)']}
      />

      {/* carrier block */}
      <Blank x1={560} x2={1060} y={176} value={details.carrier} label="Name of Carrier or Carriers" />
      <Blank x1={560} x2={1060} y={226} value={details.mainOffice} label="Main Office Address" />
      <Blank x1={560} x2={1060} y={276} value={details.homeTerminal} label="Home Terminal Address" />
    </g>
  )
}

function Grid() {
  const ticks: string[] = []
  for (let r = 0; r < 4; r++) {
    const top = ROW_Y0 + r * ROW_H
    for (let h = 0; h < 24; h++) {
      for (const q of [1, 2, 3]) {
        const x = GX0 + h * HOUR + (q * HOUR) / 4
        const len = q === 2 ? 17 : 10 // the half-hour tick is longer, as on the form
        ticks.push(`M${x} ${top}v${len}`)
      }
    }
  }
  const hourLines: string[] = []
  for (let h = 1; h < 24; h++) hourLines.push(`M${GX0 + h * HOUR} ${ROW_Y0}V${GRID_Y1}`)

  return (
    <g>
      {/* hour header band */}
      <rect x={GX0 - 48} y={BAND_Y} width={GX1 - GX0 + 76} height={BAND_H} fill={INK} />
      {Array.from({ length: 25 }, (_, h) => {
        const x = GX0 + h * HOUR
        if (h === 0 || h === 24)
          return (
            <g key={h}>
              <T x={x} y={BAND_Y + 14} size={10} weight={700} anchor="middle" fill="#fff">Mid-</T>
              <T x={x} y={BAND_Y + 27} size={10} weight={700} anchor="middle" fill="#fff">night</T>
            </g>
          )
        return (
          <T key={h} x={x} y={BAND_Y + 22} size={h === 12 ? 11 : 12.5} weight={700} anchor="middle" fill="#fff">
            {h === 12 ? 'Noon' : h % 12}
          </T>
        )
      })}
      <T x={TOTAL_X} y={BAND_Y + 14} size={10.5} anchor="middle">Total</T>
      <T x={TOTAL_X} y={BAND_Y + 27} size={10.5} anchor="middle">Hours</T>

      {/* rows */}
      <rect x={GX0} y={ROW_Y0} width={GX1 - GX0} height={4 * ROW_H} fill="#fff" stroke={INK} strokeWidth={1.5} />
      {[1, 2, 3].map((r) => (
        <line key={r} x1={GX0} x2={GX1} y1={ROW_Y0 + r * ROW_H} y2={ROW_Y0 + r * ROW_H} stroke={INK} strokeWidth={1.2} />
      ))}
      <path d={hourLines.join('')} stroke={INK} strokeWidth={0.9} />
      <path d={ticks.join('')} stroke={INK} strokeWidth={0.8} />
      {ROWS.map((row, r) => {
        const cy = ROW_Y0 + r * ROW_H + ROW_H / 2
        return row.label.length === 1 ? (
          <T key={row.status} x={22} y={cy + 4.5} size={13}>{row.label[0]}</T>
        ) : (
          <g key={row.status}>
            <T x={22} y={cy - 3} size={13}>{row.label[0]}</T>
            <T x={36} y={cy + 12} size={11.5}>{row.label[1]}</T>
          </g>
        )
      })}
      {/* totals column rules */}
      {[0, 1, 2, 3].map((r) => (
        <line
          key={r}
          x1={GX1 + 26}
          x2={W - 12}
          y1={ROW_Y0 + (r + 1) * ROW_H - 6}
          y2={ROW_Y0 + (r + 1) * ROW_H - 6}
          stroke={INK}
          strokeWidth={1}
        />
      ))}
    </g>
  )
}

/** The duty line: one continuous stroke, horizontal in the active row and vertical at every change (guide p.18). */
function DutyLine({ log, animate }: { log: DailyLog; animate: boolean }) {
  let d = ''
  let prev: DutyStatus | null = null
  for (const seg of log.segments) {
    const y = rowMid(seg.status)
    const x0 = xAt(seg.start_minute)
    const x1 = xAt(seg.end_minute)
    if (prev === null) d += `M${x0} ${y}`
    else if (prev !== seg.status) d += `V${y}`
    d += `H${x1}`
    prev = seg.status
  }
  return (
    <path
      d={d}
      fill="none"
      stroke={PEN}
      strokeWidth={3.4}
      strokeLinejoin="round"
      strokeLinecap="round"
      pathLength={animate ? 1 : undefined}
      className={animate ? 'pen-draw' : undefined}
      data-testid="duty-line"
    />
  )
}

/** CSS class + delay for elements that appear after the duty line is drawn. */
function writeIn(animate: boolean, delaySeconds: number) {
  return animate ? { className: 'pen-write', style: { animationDelay: `${delaySeconds}s` } } : {}
}

function Totals({ log, animate }: { log: DailyLog; animate: boolean }) {
  return (
    <g>
      {ROWS.map((row, i) => (
        <g key={row.status} {...writeIn(animate, 1.9 + i * 0.14)}>
          <Pen x={TOTAL_X} y={rowMid(row.status) + 8} size={23} anchor="middle">
            {log.totals_hours[row.status].toFixed(2)}
          </Pen>
        </g>
      ))}
      <g {...writeIn(animate, 2.55)}>
        <Pen x={TOTAL_X} y={GRID_Y1 + 28} size={24} anchor="middle">
          ={log.total_hours === 24 ? '24' : log.total_hours.toFixed(2)}
        </Pen>
      </g>
    </g>
  )
}

/** Playback cursor: a teal line through the grid at the scrubbed time, with a time tag. */
function Cursor({ minute }: { minute: number }) {
  const x = xAt(minute)
  const h = Math.floor(minute / 60)
  const label = `${((h + 11) % 12) + 1}:${String(minute % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return (
    <g pointerEvents="none" data-testid="log-cursor">
      <line x1={x} x2={x} y1={BAND_Y - 4} y2={GRID_Y1 + 4} stroke="#3f7f82" strokeWidth={2} />
      <rect x={x - 34} y={BAND_Y - 26} width={68} height={20} rx={10} fill="#3f7f82" />
      <text x={x} y={BAND_Y - 12} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#fff" fontFamily={PRINT_FONT}>
        {label}
      </text>
    </g>
  )
}

const LABEL_ANGLE = -55
const LABEL_TOP = GRID_Y1 + 30
const BRACKET_Y = GRID_Y1 + 18
const LABEL_GAP = 50

function Remarks({ log, animate }: { log: DailyLog; animate: boolean }) {
  const stops = buildRemarkStops(log.segments)
  const anchors = spreadAnchors(
    stops.map((s) => xAt(s.startMin)),
    LABEL_GAP,
    GX0 - 30,
    GX1 + 30,
  )
  return (
    <g>
      <T x={22} y={GRID_Y1 + 50} size={16} weight={700}>Remarks</T>
      <line x1={20} x2={20} y1={GRID_Y1 + 62} y2={900} stroke={INK} strokeWidth={4} />
      {stops.map((s, i) => {
        const fade = writeIn(animate, 1.2 + (i / Math.max(1, stops.length)) * 0.8)
        const xs = xAt(s.startMin)
        const xe = xAt(s.endMin)
        const ax = anchors[i]
        const clock = minuteToClock(s.startMin)
        return (
          <g key={i} {...fade}>
            {/* bracket under the grid spanning the stop */}
            <path
              d={xe - xs > 3 ? `M${xs} ${GRID_Y1 + 2}V${BRACKET_Y}H${xe}V${GRID_Y1 + 2}` : `M${xs} ${GRID_Y1 + 2}V${BRACKET_Y}`}
              fill="none"
              stroke={PEN}
              strokeWidth={2}
            />
            {Math.abs(ax - xs) > 1 && (
              <path d={`M${xs} ${BRACKET_Y}L${ax} ${LABEL_TOP - 6}`} stroke={PEN} strokeWidth={1} strokeDasharray="2 2" fill="none" />
            )}
            <g transform={`translate(${ax} ${LABEL_TOP}) rotate(${LABEL_ANGLE})`}>
              <text textAnchor="end" x={0} y={0} fontSize={21} fontWeight={700} fill={PEN} fontFamily={PEN_FONT}>
                {truncate(s.location || 'Unknown', 24)}
              </text>
              <text textAnchor="end" x={0} y={16} fontSize={11.5} fill={PEN} fontFamily={PRINT_FONT} opacity={0.85}>
                {truncate(`${clock} ${s.detail}`, 34)}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}

function Shipping({ details }: { details: CarrierDetails }) {
  return (
    <g>
      <T x={34} y={760} size={13} weight={700}>Shipping</T>
      <T x={34} y={777} size={13} weight={700}>Documents:</T>
      <line x1={34} x2={430} y1={818} y2={818} stroke={INK} />
      {details.manifest && <Pen x={40} y={813} size={21}>{truncate(details.manifest, 42)}</Pen>}
      <T x={34} y={834} size={11}>DVL or Manifest No.</T>
      <T x={34} y={851} size={11}>or</T>
      <line x1={34} x2={430} y1={880} y2={880} stroke={INK} />
      {details.shipper && <Pen x={40} y={875} size={21}>{truncate(details.shipper, 42)}</Pen>}
      <T x={34} y={896} size={11}>Shipper &amp; Commodity</T>

      <line x1={20} x2={W - 12} y1={912} y2={912} stroke={INK} strokeWidth={1.4} />
      <T x={W / 2} y={934} size={12.5} anchor="middle">
        Enter name of place you reported and where released from work and when and where each change of duty occurred.
      </T>
      <T x={W / 2} y={951} size={12.5} anchor="middle">Use time standard of home terminal.</T>
    </g>
  )
}

interface RecapColumn {
  x: number
  letter?: string
  lines: string[]
  value?: string
}

function Recap({ log, last5Hours }: { log: DailyLog; last5Hours: number }) {
  const top = 968
  const r = log.recap
  const cols: RecapColumn[] = [
    { x: 132, lines: ['On duty', 'hours', 'today,', 'Total lines', '3 & 4'], value: r.on_duty_today.toFixed(2) },
    { x: 330, letter: 'A.', lines: ['Total hours', 'on duty last 7', 'days including', 'today.'], value: r.cycle_total_hours.toFixed(2) },
    { x: 430, letter: 'B.', lines: ['Total hours', 'available', 'tomorrow', '70 hr. minus A*'], value: r.hours_available_tomorrow.toFixed(2) },
    { x: 530, letter: 'C.', lines: ['Total hours', 'on duty last 5', 'days including', 'today.'], value: last5Hours.toFixed(2) },
    { x: 712, letter: 'A.', lines: ['Total hours', 'on duty last 8', 'days including', 'today.'] },
    { x: 806, letter: 'B.', lines: ['Total hours', 'available', 'tomorrow', '60 hr. minus A*'] },
    { x: 900, letter: 'C.', lines: ['Total hours', 'on duty last 7', 'days including', 'today.'] },
  ]
  return (
    <g>
      <line x1={20} x2={20} y1={912} y2={H - 20} stroke={INK} strokeWidth={4} />
      <T x={30} y={top + 14} size={13} weight={700}>Recap:</T>
      <T x={30} y={top + 30} size={11.5}>Complete at</T>
      <T x={30} y={top + 45} size={11.5}>end of day</T>

      <T x={236} y={top + 14} size={12} weight={700}>70 Hour/</T>
      <T x={236} y={top + 29} size={12} weight={700}>8 Day</T>
      <T x={236} y={top + 44} size={12} weight={700}>Drivers</T>
      <T x={626} y={top + 14} size={12} weight={700}>60 Hour/ 7</T>
      <T x={626} y={top + 29} size={12} weight={700}>Day Drivers</T>

      {cols.map((c, i) => (
        <g key={i}>
          <line x1={c.x} x2={c.x + 82} y1={top + 58} y2={top + 58} stroke={INK} />
          {c.value && (
            <Pen x={c.x + 41} y={top + 52} size={24} anchor="middle">{c.value}</Pen>
          )}
          {c.letter && <T x={c.x} y={top + 78} size={15} weight={700}>{c.letter}</T>}
          {c.lines.map((l, j) => (
            <T key={j} x={c.x} y={top + (c.letter ? 96 : 76) + j * 14} size={11}>{l}</T>
          ))}
        </g>
      ))}

      {['*If you took', '34 consecutive', 'hours off duty', 'you have 60/70', 'hours', 'available'].map((l, j) => (
        <T key={j} x={998} y={top + 14 + j * 14} size={10.5}>{l}</T>
      ))}
      {r.restart_taken && (
        <Pen x={998} y={top + 120} size={19}>✓ restart</Pen>
      )}
    </g>
  )
}

interface Props {
  log: DailyLog
  details: CarrierDetails
  /** Recap column C (last 5 days incl. today), computed by the caller from earlier sheets. */
  last5Hours: number
  className?: string
  /** Draw the duty line like a pen and write the totals in (on-screen sheet only, never print/PDF). */
  animate?: boolean
  /** Minute of the day to mark with the playback cursor. */
  cursorMinute?: number | null
}

export const DailyLogSheet = memo(function DailyLogSheet({ log, details, last5Hours, className, animate = false, cursorMinute = null }: Props) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Driver's daily log for ${log.date}: ${log.totals_hours.D.toFixed(2)} hours driving, ${Math.round(log.total_miles_driving_today)} miles`}
      className={className}
      style={{ background: '#fff' }}
    >
      <rect width={W} height={H} fill="#fff" />
      <Header log={log} details={details} />
      <Grid />
      <DutyLine log={log} animate={animate} />
      <Totals log={log} animate={animate} />
      <Remarks log={log} animate={animate} />
      <Shipping details={details} />
      <Recap log={log} last5Hours={last5Hours} />
      {cursorMinute !== null && <Cursor minute={cursorMinute} />}
    </svg>
  )
})

export const SHEET_ASPECT = H / W
