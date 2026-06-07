import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { notificationsApi } from '@/api/notifications'
import { STAGE_LABELS, HOLD_REASON_LABELS, ENTITY_LABELS } from '@/types'
import type { ShipmentStage, ExternalEntity, HoldReason } from '@/types'
import { Clock, CheckCircle, AlertTriangle, Package, Boxes, Send } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// ── Palette ────────────────────────────────────────────────────────────────────

const ENTITY_COLOR: Record<string, { bar: string; bg: string; text: string; hex: string }> = {
  SHIPPING_LINE: { bar: 'bg-red-500',    bg: 'bg-red-50 dark:bg-red-900/20',      text: 'text-red-700 dark:text-red-400',      hex: '#ef4444' },
  ROP:           { bar: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-400', hex: '#f97316' },
  MOAF:          { bar: 'bg-amber-500',  bg: 'bg-amber-50 dark:bg-amber-900/20',   text: 'text-amber-700 dark:text-amber-400',   hex: '#f59e0b' },
  PORT:          { bar: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-400', hex: '#a855f7' },
  OTHER:         { bar: 'bg-gray-500',   bg: 'bg-gray-100 dark:bg-gray-700/40',    text: 'text-gray-600 dark:text-gray-400',     hex: '#6b7280' },
}

const STAGE_COLOR: Record<string, string> = {
  CUSTOMER:     'bg-gray-400',
  FFD_REVIEW:   'bg-teal-500',
  IN_PROGRESS:  'bg-blue-500',
  TRANSPORT:    'bg-purple-500',
  DC_TRANSPORT: 'bg-orange-500',
  COMPLETED:    'bg-green-500',
}

const TASK_COLOR: Record<string, string> = {
  PERMIT:   'bg-indigo-500',
  BAYAN:    'bg-violet-500',
  DO:       'bg-blue-500',
  CCRO:     'bg-teal-500',
  CCRO_ROP: 'bg-rose-500',
}

const TASK_LABEL: Record<string, string> = {
  PERMIT: 'Permit', BAYAN: 'Bayan', DO: 'Delivery Order', CCRO: 'CCRO', CCRO_ROP: 'CCRO / ROP', BAYAN_PAYMENT: 'Bayan Payment',
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ── Reusable primitives ────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string
  icon: React.ReactNode; accent: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
        <div className={clsx('p-2 rounded-lg shrink-0', accent)}>{icon}</div>
      </div>
      <div>
        <p className="text-3xl font-bold text-gray-900 dark:text-white leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{sub}</p>}
      </div>
    </div>
  )
}

function SectionCard({ title, sub, children, accentClass = 'bg-gray-300 dark:bg-gray-600' }: {
  title: string; sub?: string; children: React.ReactNode; accentClass?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b dark:border-gray-700">
        <div className="flex items-start gap-3">
          <div className={clsx('w-1 h-5 rounded-full shrink-0 mt-0.5', accentClass)} />
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
            {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
          </div>
        </div>
      </div>
      <div className="p-5 space-y-4">
        {children}
      </div>
    </div>
  )
}

function BarChart({ data }: { data: { month: string; created: number; completed: number }[] }) {
  const maxVal = Math.max(...data.map(d => d.created), 1)
  const chartH = 140
  return (
    <div className="space-y-2">
      <div className="relative" style={{ height: chartH }}>
        {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => (
          <div key={i}
            className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-700/60"
            style={{ bottom: `${frac * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-1.5">
          {data.map((d, i) => (
            <div key={i} className="flex-1 flex gap-px items-end">
              <div
                className="flex-1 bg-blue-500 rounded-t-sm transition-all duration-500 min-h-[2px] hover:bg-blue-600 cursor-default"
                style={{ height: `${Math.max((d.created / maxVal) * chartH, 2)}px` }}
                title={`${d.month}: ${d.created} created`}
              />
              <div
                className="flex-1 bg-emerald-500 rounded-t-sm transition-all duration-500 min-h-[2px] hover:bg-emerald-600 cursor-default"
                style={{ height: `${Math.max((d.completed / maxVal) * chartH, 2)}px` }}
                title={`${d.month}: ${d.completed} completed`}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-1.5">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] text-gray-400 dark:text-gray-500 truncate leading-none">{d.month}</span>
        ))}
      </div>
      <div className="flex items-center gap-5 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> Created
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Completed
        </span>
      </div>
    </div>
  )
}

function DonutChart({ segments, center }: {
  segments: { value: number; color: string; label: string }[]
  center?: string
}) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1
  const r = 34
  const circumference = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="w-28 h-28 -rotate-90">
          <circle cx={50} cy={50} r={r} fill="none" stroke="currentColor" strokeWidth={14}
            className="text-gray-100 dark:text-gray-700" />
          {segments.map((seg, i) => {
            const pct = seg.value / total
            const dash = `${pct * circumference} ${circumference}`
            const dashOff = -offset * circumference
            offset += pct
            return (
              <circle key={i} cx={50} cy={50} r={r} fill="none"
                stroke={seg.color} strokeWidth={14}
                strokeDasharray={dash} strokeDashoffset={dashOff}
                strokeLinecap="butt" />
            )
          })}
        </svg>
        {center && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-base font-bold text-gray-800 dark:text-gray-100">{center}</span>
          </div>
        )}
      </div>
      <div className="space-y-2 min-w-0">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-gray-600 dark:text-gray-300 truncate">{seg.label}</span>
            <span className="ml-auto font-bold text-gray-800 dark:text-gray-100 pl-2 tabular-nums">
              {Math.round((seg.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HBar({ label, sub, value, max, colorClass, badge }: {
  label: string; sub?: string; value: number; max: number
  colorClass: string; badge?: React.ReactNode
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">{label}</span>
          {sub && <span className="text-xs text-gray-400 ml-1.5">{sub}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100 w-12 text-right tabular-nums">{value}</span>
        </div>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={clsx('h-2 rounded-full transition-all duration-700', colorClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function HoldDurationChart({ data }: { data: { entity: string; avg_hold_days: number | null; count: number }[] }) {
  const withDuration = data.filter(d => d.avg_hold_days != null)
  if (withDuration.length === 0) return (
    <p className="text-sm text-gray-400 py-8 text-center">
      No resolved holds yet — duration data appears after a hold is released
    </p>
  )
  const maxVal = Math.max(...withDuration.map(d => d.avg_hold_days!), 1)
  const chartH = 120

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4" style={{ height: chartH + 28 }}>
        {withDuration.map((d, i) => {
          const c = ENTITY_COLOR[d.entity] ?? ENTITY_COLOR['OTHER']
          const barH = Math.max((d.avg_hold_days! / maxVal) * chartH, 6)
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200 leading-none tabular-nums">
                {d.avg_hold_days}d
              </span>
              <div
                className={clsx('w-full rounded-t-lg cursor-default', c.bar)}
                style={{ height: `${barH}px` }}
                title={`${ENTITY_LABELS[d.entity as ExternalEntity] ?? d.entity}: ${d.avg_hold_days}d avg · ${d.count} hold${d.count !== 1 ? 's' : ''}`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-4">
        {withDuration.map((d, i) => {
          const c = ENTITY_COLOR[d.entity] ?? ENTITY_COLOR['OTHER']
          return (
            <div key={i} className="flex-1 text-center space-y-0.5">
              <span className={clsx('text-xs font-semibold block truncate', c.text)}>
                {ENTITY_LABELS[d.entity as ExternalEntity] ?? d.entity}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">{d.count} hold{d.count !== 1 ? 's' : ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ShippingLineTable({ rows }: {
  rows: { shipping_line: string; shipment_count: number; hold_count: number; avg_hold_days: number | null; top_reason: string | null }[]
}) {
  if (!rows || rows.length === 0) return (
    <p className="text-sm text-gray-400 py-4 text-center">No shipping line data for this period</p>
  )
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b dark:border-gray-700">
            <th className="text-left py-2.5 px-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Shipping Line</th>
            <th className="text-center py-2.5 px-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Shipments</th>
            <th className="text-center py-2.5 px-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Holds</th>
            <th className="text-left py-2.5 px-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Top Reason</th>
            <th className="text-right py-2.5 px-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Hold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <td className="py-3 px-3 font-semibold text-gray-800 dark:text-gray-100">{row.shipping_line}</td>
              <td className="py-3 px-3 text-center tabular-nums text-gray-600 dark:text-gray-300">{row.shipment_count}</td>
              <td className="py-3 px-3 text-center">
                {row.hold_count > 0 ? (
                  <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 tabular-nums">
                    {row.hold_count}
                  </span>
                ) : (
                  <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                )}
              </td>
              <td className="py-3 px-3 text-gray-600 dark:text-gray-300 max-w-[200px]">
                {row.top_reason ? (
                  <span className="truncate block text-xs" title={HOLD_REASON_LABELS[row.top_reason as HoldReason] ?? row.top_reason}>
                    {HOLD_REASON_LABELS[row.top_reason as HoldReason] ?? row.top_reason}
                  </span>
                ) : (
                  <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                )}
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300 text-xs font-medium">
                {row.avg_hold_days != null ? `${row.avg_hold_days}d` : <span className="text-gray-300 dark:text-gray-600">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Date range picker with presets ────────────────────────────────────────────

const START_YEAR = 2024
type Preset = '3m' | '6m' | '12m' | 'ytd' | 'custom'

const PRESETS: { key: Preset; label: string }[] = [
  { key: '3m',     label: 'Last 3 months' },
  { key: '6m',     label: 'Last 6 months' },
  { key: '12m',    label: 'Last 12 months' },
  { key: 'ytd',    label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
]

function applyPreset(preset: Preset) {
  const now = new Date()
  const toYear = now.getFullYear()
  const toMonth = now.getMonth() + 1
  if (preset === '3m') {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    return { fromYear: d.getFullYear(), fromMonth: d.getMonth() + 1, toYear, toMonth }
  }
  if (preset === '6m') {
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    return { fromYear: d.getFullYear(), fromMonth: d.getMonth() + 1, toYear, toMonth }
  }
  if (preset === 'ytd') {
    return { fromYear: toYear, fromMonth: 1, toYear, toMonth }
  }
  // 12m
  const d = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  return { fromYear: d.getFullYear(), fromMonth: d.getMonth() + 1, toYear, toMonth }
}

function MonthYearSelect({ year, month, onChange, cap }: {
  year: number; month: number
  onChange: (y: number, m: number) => void
  cap: { year: number; month: number }
}) {
  const years: number[] = []
  for (let y = START_YEAR; y <= cap.year; y++) years.push(y)
  return (
    <div className="flex gap-1.5">
      <select
        value={month}
        onChange={e => onChange(year, Number(e.target.value))}
        className="text-sm border dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {MONTH_ABBR.map((label, i) => {
          const mo = i + 1
          return <option key={mo} value={mo} disabled={year === cap.year && mo > cap.month}>{label}</option>
        })}
      </select>
      <select
        value={year}
        onChange={e => {
          const y = Number(e.target.value)
          onChange(y, y === cap.year ? Math.min(month, cap.month) : month)
        }}
        className="text-sm border dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

function defaultRange() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  return {
    fromYear: d.getFullYear(), fromMonth: d.getMonth() + 1,
    toYear: now.getFullYear(), toMonth: now.getMonth() + 1,
  }
}

export function Reports() {
  const { user } = useAuth()
  const defaults = defaultRange()
  const now = new Date()
  const cap = { year: now.getFullYear(), month: now.getMonth() + 1 }

  const [preset, setPreset] = useState<Preset>('12m')
  const [reportSending, setReportSending] = useState(false)

  const canSendReport = user?.team === 'TRANSPORT' || user?.team === 'FFD' || user?.is_admin

  async function handleSendReport() {
    setReportSending(true)
    try {
      await notificationsApi.sendDailyReportNow()
      toast.success('Daily report queued for delivery')
    } catch {
      toast.error('Failed to send daily report')
    } finally {
      setReportSending(false)
    }
  }
  const [fromYear, setFromYear] = useState(defaults.fromYear)
  const [fromMonth, setFromMonth] = useState(defaults.fromMonth)
  const [toYear, setToYear] = useState(defaults.toYear)
  const [toMonth, setToMonth] = useState(defaults.toMonth)

  function handlePreset(p: Preset) {
    setPreset(p)
    if (p !== 'custom') {
      const r = applyPreset(p)
      setFromYear(r.fromYear); setFromMonth(r.fromMonth)
      setToYear(r.toYear);    setToMonth(r.toMonth)
    }
  }

  function handleFromChange(y: number, m: number) {
    setFromYear(y); setFromMonth(m)
    if (y * 12 + m > toYear * 12 + toMonth) { setToYear(y); setToMonth(m) }
  }
  function handleToChange(y: number, m: number) {
    setToYear(y); setToMonth(m)
    if (y * 12 + m < fromYear * 12 + fromMonth) { setFromYear(y); setFromMonth(m) }
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reports', fromYear, fromMonth, toYear, toMonth],
    queryFn: () =>
      api.get(`/analytics/reports?from_year=${fromYear}&from_month=${fromMonth}&to_year=${toYear}&to_month=${toMonth}`)
        .then(r => r.data),
    retry: 1,
  })

  const fromLabel = `${MONTH_ABBR[fromMonth - 1]} ${fromYear}`
  const toLabel   = `${MONTH_ABBR[toMonth - 1]} ${toYear}`

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {user?.team === 'CUSTOMER' ? 'Your shipment activity and history' : 'Operational analytics and performance metrics'}
          </p>
        </div>
        {canSendReport && (
          <button
            onClick={handleSendReport}
            disabled={reportSending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0"
          >
            <Send size={14} />
            {reportSending ? 'Sending…' : 'Send Daily Report'}
          </button>
        )}
      </div>

      {/* Period selector */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mr-1">Period</span>
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => handlePreset(p.key)}
              className={clsx(
                'text-xs px-3 py-1.5 rounded-full font-medium transition-all',
                preset === p.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              )}
            >
              {p.label}
            </button>
          ))}
          {preset !== 'custom' && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
              {fromLabel} – {toLabel}
            </span>
          )}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t dark:border-gray-700">
            <span className="text-xs text-gray-500 dark:text-gray-400">From</span>
            <MonthYearSelect year={fromYear} month={fromMonth} onChange={handleFromChange} cap={cap} />
            <span className="text-xs text-gray-400 px-1">→</span>
            <MonthYearSelect year={toYear} month={toMonth} onChange={handleToChange} cap={cap} />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}
          </div>
        </div>
      ) : isError ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 space-y-2">
          <p className="font-semibold text-red-700 dark:text-red-400">Failed to load reports</p>
          <p className="text-sm text-red-600 dark:text-red-300">
            {(error as any)?.response?.data?.detail ?? (error as any)?.message ?? 'Unknown error — check the backend logs.'}
          </p>
        </div>
      ) : !data ? null : (
        <OperationalReports data={data} fromLabel={fromLabel} toLabel={toLabel} />
      )}
    </div>
  )
}

// ── Operational view ───────────────────────────────────────────────────────────

function OperationalReports({ data, fromLabel, toLabel }: { data: any; fromLabel: string; toLabel: string }) {
  const s = data.summary
  const onTimeTotal = (s.on_time + s.late) || 1
  const onTimePct   = Math.round((s.on_time / onTimeTotal) * 100)

  const rejTotal = (data.rejection?.approved + data.rejection?.rejected) || 1
  const rejPct   = Math.round(((data.rejection?.rejected || 0) / rejTotal) * 100)

  const maxHoldCount = Math.max(...(data.holds_by_entity || []).map((h: any) => h.count), 1)
  const maxStageDays = Math.max(...(data.stage_durations || []).map((d: any) => d.avg_days), 1)
  const maxTaskDays  = Math.max(...(data.task_durations  || []).map((t: any) => t.avg_days), 1)

  const stageOrder = ['CUSTOMER', 'FFD_REVIEW', 'IN_PROGRESS', 'TRANSPORT', 'DC_TRANSPORT', 'COMPLETED']
  const sortedStages = [...(data.stage_durations || [])].sort(
    (a: any, b: any) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage)
  )

  const periodSub = `${fromLabel} – ${toLabel}`

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          label="Shipments"
          value={s.total_shipments.toLocaleString()}
          sub={`${s.total_completed} completed · ${s.total_active} active`}
          icon={<Package size={16} className="text-blue-600" />}
          accent="bg-blue-50 dark:bg-blue-900/30"
        />
        <KpiCard
          label="Avg Cycle Time"
          value={s.avg_cycle_days ? `${s.avg_cycle_days}d` : '—'}
          sub="creation → completion"
          icon={<Clock size={16} className="text-purple-600" />}
          accent="bg-purple-50 dark:bg-purple-900/30"
        />
        <KpiCard
          label="On-Time Delivery"
          value={`${onTimePct}%`}
          sub={`${s.on_time} on-time · ${s.late} late`}
          icon={<CheckCircle size={16} className="text-emerald-600" />}
          accent="bg-emerald-50 dark:bg-emerald-900/30"
        />
        <KpiCard
          label="Doc Send-back Rate"
          value={`${rejPct}%`}
          sub={`${data.rejection?.rejected || 0} sent back of ${rejTotal}`}
          icon={<AlertTriangle size={16} className="text-red-500" />}
          accent="bg-red-50 dark:bg-red-900/30"
        />
        <KpiCard
          label="Containers Returned by Transport"
          value={(s.containers_returned ?? 0).toLocaleString()}
          icon={<Boxes size={16} className="text-teal-600" />}
          accent="bg-teal-50 dark:bg-teal-900/30"
        />
        <KpiCard
          label="Containers Moved by FFD/MBRF"
          value={(s.containers_closed ?? 0).toLocaleString()}
          icon={<Boxes size={16} className="text-orange-600" />}
          accent="bg-orange-50 dark:bg-orange-900/30"
        />
      </div>

      {/* Row 1: Monthly volume + On-time donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SectionCard title="Monthly Shipment Volume" sub={`Created vs completed — ${periodSub}`} accentClass="bg-blue-500">
            {data.monthly_volume?.length > 0
              ? <BarChart data={data.monthly_volume} />
              : <p className="text-sm text-gray-400 py-8 text-center">No data for this period</p>}
          </SectionCard>
        </div>
        <SectionCard title="On-Time Delivery" sub="Completed vs pull-out date" accentClass="bg-emerald-500">
          {onTimeTotal > 1 ? (
            <DonutChart
              center={`${onTimePct}%`}
              segments={[
                { value: s.on_time, color: '#10b981', label: `On time (${s.on_time})` },
                { value: s.late,    color: '#ef4444', label: `Late (${s.late})` },
              ]}
            />
          ) : <p className="text-sm text-gray-400 py-8 text-center">No completed shipments with a pull-out date yet</p>}
        </SectionCard>
      </div>

      {/* Row 2: Stage + Task durations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Avg Time per Stage" sub={`Days per stage — ${periodSub}`} accentClass="bg-indigo-500">
          {sortedStages.length > 0 ? (
            <div className="space-y-4">
              {sortedStages.map((s: any) => (
                <HBar
                  key={s.stage}
                  label={STAGE_LABELS[s.stage as ShipmentStage] ?? s.stage}
                  sub={`${s.count} transitions`}
                  value={s.avg_days}
                  max={maxStageDays}
                  colorClass={STAGE_COLOR[s.stage] ?? 'bg-gray-400'}
                  badge={<span className="text-xs font-semibold text-gray-600 dark:text-gray-300 tabular-nums">{s.avg_days}d</span>}
                />
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">Not enough event data yet</p>}
        </SectionCard>

        <SectionCard title="Avg Task Completion Time" sub="How long each task type takes to close" accentClass="bg-violet-500">
          {data.task_durations?.length > 0 ? (
            <div className="space-y-4">
              {(data.task_durations as any[])
                .sort((a, b) => b.avg_days - a.avg_days)
                .map((t: any) => (
                  <HBar
                    key={t.task}
                    label={TASK_LABEL[t.task] ?? t.task}
                    sub={`${t.count} tasks`}
                    value={t.avg_days}
                    max={maxTaskDays}
                    colorClass={TASK_COLOR[t.task] ?? 'bg-gray-400'}
                    badge={<span className="text-xs font-semibold text-gray-600 dark:text-gray-300 tabular-nums">{t.avg_days}d</span>}
                  />
                ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">No completed tasks yet</p>}
        </SectionCard>
      </div>

      {/* Row 3: Holds — count + avg duration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="External Holds by Party" sub={`Count and avg resolution time — ${periodSub}`} accentClass="bg-amber-500">
          {data.holds_by_entity?.length > 0 ? (
            <div className="space-y-3">
              {(data.holds_by_entity as any[]).map((h: any) => {
                const c = ENTITY_COLOR[h.entity] ?? ENTITY_COLOR['OTHER']
                return (
                  <div key={h.entity} className={clsx('rounded-lg p-3.5 space-y-2.5', c.bg)}>
                    <div className="flex items-center justify-between">
                      <span className={clsx('text-sm font-semibold', c.text)}>
                        {ENTITY_LABELS[h.entity as ExternalEntity] ?? h.entity}
                      </span>
                      <div className="flex items-center gap-3">
                        {h.avg_hold_days != null && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                            avg {h.avg_hold_days}d
                          </span>
                        )}
                        <span className={clsx('text-xl font-bold tabular-nums', c.text)}>{h.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-white/50 dark:bg-gray-600/30 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-1.5 rounded-full transition-all duration-700', c.bar)}
                        style={{ width: `${Math.min((h.count / maxHoldCount) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No holds recorded in this period</p>}
        </SectionCard>

        <SectionCard title="Avg Hold Duration by Party" sub="Days to resolve a hold (released holds only)" accentClass="bg-red-500">
          <HoldDurationChart data={data.holds_by_entity ?? []} />
        </SectionCard>
      </div>

      {/* Row 4: Top hold reasons */}
      <SectionCard title="Top Hold Reasons" sub={`Most frequent reasons — ${periodSub}`} accentClass="bg-orange-500">
        {data.top_hold_reasons?.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(data.top_hold_reasons as any[]).map((r: any, i: number) => {
              const entityKey = r.reason === 'OTHER' ? 'OTHER' : r.reason.split('_')[0]
              const c = ENTITY_COLOR[entityKey] ?? ENTITY_COLOR['OTHER']
              return (
                <div key={i} className={clsx('flex items-center justify-between px-3.5 py-2.5 rounded-lg', c.bg)}>
                  <p className={clsx('text-xs font-medium', c.text)}>
                    {HOLD_REASON_LABELS[r.reason as HoldReason] ?? r.reason}
                  </p>
                  <span className={clsx('text-sm font-bold shrink-0 ml-3 tabular-nums', c.text)}>{r.count}</span>
                </div>
              )
            })}
          </div>
        ) : <p className="text-sm text-gray-400 py-4 text-center">No holds recorded in this period</p>}
      </SectionCard>

      {/* Row 5: Shipping line breakdown */}
      <SectionCard title="Shipping Line Summary" sub={`Shipments, holds, and avg resolution time per shipping line — ${periodSub}`} accentClass="bg-sky-500">
        <ShippingLineTable rows={data.shipping_line_breakdown ?? []} />
      </SectionCard>
    </div>
  )
}
