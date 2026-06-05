import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/dates'
import { STAGE_LABELS, ENTITY_LABELS, HOLD_REASON_LABELS, TASK_TYPE_LABELS } from '@/types'
import type { ShipmentStage, ExternalEntity, HoldReason, TaskType } from '@/types'
import { AlertTriangle, CheckCircle, Clock, Package, TrendingUp, ArrowRight, Minus, ChevronDown, Layers } from 'lucide-react'
import { useSortable } from '@/lib/sort'
import { SortableHeader } from '@/components/SortableHeader'
import clsx from 'clsx'

const STAGE_COLORS: Record<string, string> = {
  CUSTOMER:    'bg-gray-100 text-gray-700',
  FFD_REVIEW:  'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  TRANSPORT:   'bg-purple-100 text-purple-800',
  DC_TRANSPORT:'bg-orange-100 text-orange-800',
  COMPLETED:   'bg-green-100 text-green-800',
}

const STAGE_BAR_COLORS: Record<string, string> = {
  CUSTOMER:    'bg-gray-400',
  FFD_REVIEW:  'bg-blue-500',
  IN_PROGRESS: 'bg-blue-500',
  TRANSPORT:   'bg-purple-500',
  DC_TRANSPORT:'bg-orange-500',
  COMPLETED:   'bg-green-500',
}

const ENTITY_COLORS: Record<string, string> = {
  SHIPPING_LINE: 'bg-red-100 text-red-700',
  ROP:           'bg-orange-100 text-orange-700',
  MOAF:          'bg-amber-100 text-amber-700',
  PORT:          'bg-purple-100 text-purple-700',
}

const CONTAINER_STATUS_CONFIG = [
  { key: 'PENDING',         label: 'Pending',             color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
  { key: 'AWAITING_TRUCK',  label: 'Awaiting Truck',      color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  { key: 'ASSIGNED',        label: 'Trucks Assigned',     color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' },
  { key: 'IN_TRANSIT',      label: 'In Transit',          color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  { key: 'BREAKDOWN',       label: 'Breakdown',           color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  { key: 'CCRO_RETURNED',   label: 'With FFD',            color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
  { key: 'DO_REVALIDATION', label: 'Pending Revalidation', color: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' },
  { key: 'AT_DC',           label: 'Reported to DC',      color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
  { key: 'OFFLOADED',       label: 'Offloaded',           color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  { key: 'RETURNED',        label: 'Returned',            color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400' },
] as const

type DocStatus = 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | null | undefined

function DocStatusPill({ label, status }: { label: string; status: DocStatus }) {
  const config = {
    COMPLETED:   { dot: 'bg-green-500',  text: 'text-green-700 dark:text-green-400',  bg: 'bg-green-50 dark:bg-green-900/20',  icon: <CheckCircle size={11} /> },
    ON_HOLD:     { dot: 'bg-red-500',    text: 'text-red-700 dark:text-red-400',      bg: 'bg-red-50 dark:bg-red-900/20',      icon: <AlertTriangle size={11} /> },
    IN_PROGRESS: { dot: 'bg-blue-500',   text: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-900/20',   icon: <Clock size={11} /> },
  } as const

  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500">
        <Minus size={11} /> {label}
      </span>
    )
  }
  const c = config[status]
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', c.bg, c.text)}>
      {c.icon} {label}
    </span>
  )
}

function StatCard({ label, value, sub, icon, color, containerCount }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string
  containerCount?: number
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 flex items-start gap-4">
      <div className={clsx('p-2.5 rounded-lg shrink-0', color)}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        {containerCount != null && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 flex items-center gap-1">
            <Package size={10} className="shrink-0" />
            {containerCount} container{containerCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function formatHoldDuration(heldAt: string | null | undefined): { label: string; color: string } {
  if (!heldAt) return { label: '—', color: 'text-gray-400' }
  const ms = Date.now() - new Date(heldAt).getTime()
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 60) return { label: `${totalMinutes}m`, color: 'text-gray-600 dark:text-gray-300' }
  const hours = Math.floor(totalMinutes / 60)
  let label: string
  if (hours < 24) {
    label = `${hours}h`
  } else {
    const days = Math.floor(hours / 24)
    const rem = hours % 24
    label = rem > 0 ? `${days}d ${rem}h` : `${days}d`
  }
  const color = hours >= 48 ? 'text-red-600 dark:text-red-400 font-semibold'
              : hours >= 24 ? 'text-amber-600 dark:text-amber-400 font-semibold'
              : 'text-gray-600 dark:text-gray-300'
  return { label, color }
}

export function Dashboard() {
  const [docStatusOpen, setDocStatusOpen] = useState(false)
  const [holdsOpen, setHoldsOpen] = useState(true)
  const [volumeOpen, setVolumeOpen] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then(r => r.data),
    refetchInterval: 5 * 60_000,
  })

  const { sorted: sortedShipments, sort: shipSort, toggle: shipToggle } = useSortable(
    (data as any)?.shipments ?? [],
    (s: any, col) => {
      switch (col) {
        case 'bl':         return s.bl_number
        case 'invoice':    return s.invoice_number
        case 'stage':      return s.current_stage
        case 'containers': return s.actual_containers ?? 0
        case 'pull_out':   return s.pull_out_date
        case 'days':       return s.days_active
        case 'status':     return s.on_hold ? 1 : 0
        default:           return null
      }
    }
  )
  const { sorted: sortedHolds, sort: holdSort, toggle: holdToggle } = useSortable(
    (data as any)?.active_holds ?? [],
    (h: any, col) => {
      switch (col) {
        case 'bl':         return h.bl_number
        case 'held_by':    return h.hold_entity
        case 'party':      return h.shipping_line ?? h.hold_entity
        case 'containers': return h.container_count ?? 0
        case 'reason':     return h.hold_reason
        case 'time':       return h.held_at
        default:           return null
      }
    }
  )
  const { sorted: sortedVolume, sort: volSort, toggle: volToggle } = useSortable(
    (data as any)?.volume_by_date ?? [],
    (r: any, col) => {
      switch (col) {
        case 'created':    return r.earliest_created
        case 'pull_out':   return r.pull_out_date
        case 'bls':        return r.bl_count
        case 'containers': return r.container_total
        default:           return null
      }
    }
  )

  const TASK_LABELS: Record<string, string> = {
    PERMIT:   'Permit (PRO)',
    BAYAN:    'Bayan (PRO)',
    DO:       'Delivery Order (FFD)',
    CCRO:     'CCRO (FFD)',
    CCRO_ROP: 'CCRO — ROP (PRO)',
  }

  if (isLoading) return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}</div>
      <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl" />
    </div>
  )

  if (!data) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <p className="text-gray-500 dark:text-gray-400 text-sm">Failed to load dashboard. The backend may need a database migration.</p>
      <code className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded">alembic upgrade head</code>
    </div>
  )

  const { summary, by_stage, bayan_payment_pending, task_pipeline, entity_breakdown, active_holds, in_progress_doc_status, shipments, container_status_counts, containers_by_stage, volume_by_date } = data
  const totalInPipeline = (summary.total_active + summary.total_completed) || 1
  const nonProgressStages: ShipmentStage[] = ['CUSTOMER', 'FFD_REVIEW', 'TRANSPORT', 'DC_TRANSPORT', 'COMPLETED']

  // Pipeline label overrides (shorter labels for the overview)
  const PIPELINE_LABELS: Partial<Record<string, string>> = {
    FFD_REVIEW: 'FFD Review',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Operations Dashboard</h1>
        <p className="text-xs text-gray-400">Auto-refreshes every 5 min</p>
      </div>

      {/* ── Stat cards ── */}
      {(() => {
        const totalActiveContainers = (Object.values(container_status_counts ?? {}) as number[]).reduce((a, b) => a + b, 0)
        const containersOnHold = (active_holds as any[]).reduce((sum: number, h: any) => sum + (h.container_count ?? 0), 0)
        return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Shipments"
          value={summary.total_active}
          sub="currently in pipeline"
          icon={<Package size={20} className="text-blue-600" />}
          color="bg-blue-50"
          containerCount={totalActiveContainers > 0 ? totalActiveContainers : undefined}
        />
        <StatCard
          label="On Hold"
          value={summary.total_on_hold}
          sub="waiting on external party"
          icon={<AlertTriangle size={20} className="text-red-500" />}
          color="bg-red-50"
          containerCount={containersOnHold > 0 ? containersOnHold : undefined}
        />
        <StatCard
          label="Completed"
          value={summary.total_completed}
          sub="shipments fully returned"
          icon={<CheckCircle size={20} className="text-green-600" />}
          color="bg-green-50"
          containerCount={summary.completed_containers > 0 ? summary.completed_containers : undefined}
        />
        <StatCard
          label="Avg. Processing Time"
          value={summary.avg_completion_days ? `${summary.avg_completion_days}d` : '—'}
          sub="from creation to return"
          icon={<TrendingUp size={20} className="text-purple-600" />}
          color="bg-purple-50"
        />
      </div>
        )
      })()}

      {/* ── Container Status widget ── */}
      {container_status_counts && Object.keys(container_status_counts).length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-gray-500 dark:text-gray-400" />
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Active Containers</h2>
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {(Object.values(container_status_counts) as number[]).reduce((a, b) => a + b, 0)} total
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {CONTAINER_STATUS_CONFIG.map(({ key, label, color }) => {
              const count = (container_status_counts as Record<string, number>)[key] ?? 0
              if (count === 0) return null
              return (
                <span key={key} className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm', color)}>
                  <span className="font-bold tabular-nums">{count}</span>
                  <span className="font-normal text-xs opacity-75">{label}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Pipeline progress ── */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Pipeline Overview</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Shipments by stage — task breakdown shown for In Progress</p>
          </div>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-3 mb-2 pb-2 border-b dark:border-gray-700">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500 w-48 shrink-0 uppercase tracking-wide">Stage</span>
          <span className="flex-1" />
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0" style={{ minWidth: '9rem', textAlign: 'right' }}>Count</span>
        </div>

        <div className="space-y-1">
          {nonProgressStages.map(stage => {
            if (stage === 'TRANSPORT') return (
              <div key="task-group">
                {/* ── In Progress parent row ── */}
                {(() => {
                  const inProgressCount = in_progress_doc_status?.length || 0
                  const inProgressContainers = (containers_by_stage as Record<string, number>)?.['IN_PROGRESS'] ?? 0
                  const pct = Math.round((inProgressCount / totalInPipeline) * 100)
                  return (
                    <div className="flex items-center gap-3 py-1.5">
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-400 w-48 shrink-0">
                        In Progress
                      </span>
                      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                        <div className="h-full bg-blue-400 dark:bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-semibold text-blue-700 dark:text-blue-400 shrink-0 text-right" style={{ minWidth: '9rem' }}>
                        <span className="block">{inProgressCount} {inProgressCount === 1 ? 'shipment' : 'shipments'}</span>
                        {inProgressContainers > 0 && (
                          <span className="block text-xs font-normal opacity-60 mt-0.5">{inProgressContainers} containers</span>
                        )}
                      </span>
                    </div>
                  )
                })()}

                {/* ── Task rows (indented) ── */}
                {Object.entries(task_pipeline).map(([taskType, counts]: [string, any]) => {
                  const completed  = counts.completed  ?? 0
                  const active     = counts.active     ?? 0
                  const onHold     = counts.on_hold    ?? 0
                  const unassigned = counts.unassigned ?? 0
                  const total = completed + active + onHold + unassigned
                  if (total === 0) return null

                  const completedPct   = Math.round((completed  / totalInPipeline) * 100)
                  const unassignedPct  = Math.round((unassigned / totalInPipeline) * 100)
                  const activePct      = Math.round((active     / totalInPipeline) * 100)
                  const holdPct        = Math.round((onHold     / totalInPipeline) * 100)
                  const totalPct       = completedPct + unassignedPct + activePct + holdPct
                  return (
                    <div key={taskType} className="flex items-center gap-3 py-1 pl-4 border-l-2 border-blue-100 dark:border-blue-900 ml-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400 w-44 shrink-0">
                        {TASK_LABELS[taskType] || taskType}
                      </span>
                      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                        {totalPct > 0 && (
                          <div className="h-full flex" style={{ width: `${totalPct}%` }}>
                            {completedPct  > 0 && <div className="h-full bg-green-500"  style={{ width: `${(completedPct  / totalPct) * 100}%` }} />}
                            {unassignedPct > 0 && <div className="h-full bg-amber-400"  style={{ width: `${(unassignedPct / totalPct) * 100}%` }} />}
                            {activePct     > 0 && <div className="h-full bg-blue-500"   style={{ width: `${(activePct     / totalPct) * 100}%` }} />}
                            {holdPct       > 0 && <div className="h-full bg-red-500"    style={{ width: `${(holdPct       / totalPct) * 100}%` }} />}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 justify-end flex-wrap" style={{ minWidth: '9rem' }}>
                        {completed > 0 && (
                          <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                            ✓ {completed}
                          </span>
                        )}
                        {unassigned > 0 && (
                          <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                            {unassigned} unassigned
                          </span>
                        )}
                        {active > 0 && (
                          <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-medium">
                            {active} active
                          </span>
                        )}
                        {onHold > 0 && (
                          <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded-full font-medium">
                            {onHold} held
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* ── Transport row ── */}
                {(() => {
                  const count = by_stage['TRANSPORT'] || 0
                  const transportContainers = (containers_by_stage as Record<string, number>)?.['TRANSPORT'] ?? 0
                  const pct = Math.round((count / totalInPipeline) * 100)
                  const isEmpty = count === 0
                  return (
                    <div className="flex items-center gap-3 py-1.5 mt-1">
                      <span className={clsx('text-sm w-48 shrink-0', isEmpty ? 'text-gray-400 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300 font-medium')}>
                        {STAGE_LABELS['TRANSPORT']}
                      </span>
                      <div className="flex-1">
                        {!isEmpty && (
                          <div className="bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                            <div className={clsx('h-2 rounded-full transition-all', STAGE_BAR_COLORS['TRANSPORT'])} style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                      <span className={clsx('text-sm shrink-0 text-right', isEmpty ? 'text-gray-400 dark:text-gray-600' : 'font-semibold text-gray-800 dark:text-gray-100')} style={{ minWidth: '9rem' }}>
                        {isEmpty ? '—' : (
                          <>
                            <span className="block">{count}</span>
                            {transportContainers > 0 && (
                              <span className="block text-xs font-normal opacity-60 mt-0.5">{transportContainers} containers</span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  )
                })()}
              </div>
            )
            const stageCount = by_stage[stage] || 0
            const extraCount = stage === 'CUSTOMER' ? (bayan_payment_pending || 0) : 0
            const count = stageCount + extraCount
            const stageContainers = (containers_by_stage as Record<string, number>)?.[stage] ?? 0
            const pct = Math.round((count / totalInPipeline) * 100)
            const isEmpty = count === 0
            return (
              <div key={stage} className="flex items-center gap-3 py-1.5">
                <span className={clsx('text-sm w-48 shrink-0', isEmpty ? 'text-gray-400 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300 font-medium')}>
                  {PIPELINE_LABELS[stage] ?? STAGE_LABELS[stage]}
                </span>
                <div className="flex-1">
                  {!isEmpty && (
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div className={clsx('h-2 rounded-full transition-all', STAGE_BAR_COLORS[stage])} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 justify-end" style={{ minWidth: '9rem' }}>
                  <span className={clsx('text-sm text-right', isEmpty ? 'text-gray-400 dark:text-gray-600' : 'font-semibold text-gray-800 dark:text-gray-100')}>
                    {isEmpty ? '—' : (
                      <>
                        <span className="block">{count}</span>
                        {stageContainers > 0 && (
                          <span className="block text-xs font-normal opacity-60 mt-0.5">{stageContainers} containers</span>
                        )}
                      </>
                    )}
                  </span>
                  {stage === 'FFD_REVIEW' && count > 0 && (
                    <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                      under review
                    </span>
                  )}
                  {stage === 'CUSTOMER' && extraCount > 0 && (
                    <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                      {extraCount} payment
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-5 mt-4 pt-3 border-t dark:border-gray-700 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0 inline-block" /> Done
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 inline-block" /> Pending assignment
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0 inline-block" /> Active
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 inline-block" /> On Hold
          </div>
        </div>
      </div>

      {/* ── In Progress — Document Status (collapsible) ── */}
      {in_progress_doc_status?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setDocStatusOpen(o => !o)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
          >
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">In Progress — Document Status</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {docStatusOpen
                  ? `${in_progress_doc_status.length} shipments — Permit · DO · Bayan`
                  : `Expand to see per-shipment document status (${in_progress_doc_status.length} shipments)`}
              </p>
            </div>
            <ChevronDown
              size={18}
              className={clsx('text-gray-400 transition-transform duration-200 shrink-0', docStatusOpen && 'rotate-180')}
            />
          </button>

          {docStatusOpen && (
            <div className="divide-y dark:divide-gray-700 border-t dark:border-gray-700 max-h-80 overflow-y-auto">
              {in_progress_doc_status.map((s: any) => (
                <Link
                  key={s.shipment_id}
                  to={`/shipments/${s.shipment_id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">BL: {s.bl_number}</p>
                    {s.pull_out_date && (
                      <p className="text-xs text-gray-400 mt-0.5">Pull-out {formatDate(s.pull_out_date)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <DocStatusPill label="Permit" status={s.permit} />
                    <DocStatusPill label="DO" status={s.do} />
                    <DocStatusPill label="Bayan" status={s.bayan} />
                    <ArrowRight size={14} className="text-gray-300 ml-1" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Active Holds table ── */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setHoldsOpen(o => !o)}
          className="w-full px-5 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
        >
          <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">
                Active Holds
                {active_holds.length > 0 && (
                  <span className="ml-2 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-full">
                    {active_holds.length}
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {holdsOpen ? 'Sorted by longest waiting first' : 'Click to expand'}
              </p>
            </div>
            {Object.entries(entity_breakdown).map(([entity, count]) => (
              <span key={entity} className={clsx('text-xs px-2.5 py-1 rounded-full font-medium', ENTITY_COLORS[entity] || 'bg-gray-100 text-gray-700')}>
                {ENTITY_LABELS[entity as ExternalEntity] || entity}: {count as number}
              </span>
            ))}
          </div>
          <ChevronDown
            size={18}
            className={clsx('text-gray-400 transition-transform duration-200 shrink-0', holdsOpen && 'rotate-180')}
          />
        </button>

        {holdsOpen && (active_holds.length === 0 ? (
          <p className="text-sm text-gray-400 py-10 text-center">No active holds — all shipments are moving</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                <tr>
                  <SortableHeader label="B/L Number"   column="bl"         sort={holdSort} onSort={holdToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Held By"      column="held_by"    sort={holdSort} onSort={holdToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Specific Party" column="party"    sort={holdSort} onSort={holdToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Containers"   column="containers" sort={holdSort} onSort={holdToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Hold Reason"  column="reason"     sort={holdSort} onSort={holdToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Time on Hold" column="time"       sort={holdSort} onSort={holdToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {sortedHolds.map((hold: any, i: number) => {
                  const duration = formatHoldDuration(hold.held_at)
                  const specificParty = hold.hold_entity === 'SHIPPING_LINE'
                    ? (hold.shipping_line || '—')
                    : (ENTITY_LABELS[hold.hold_entity as ExternalEntity] || hold.hold_entity)
                  return (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900 dark:text-white">{hold.bl_number}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{TASK_TYPE_LABELS[hold.task_type as TaskType]}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', ENTITY_COLORS[hold.hold_entity] || 'bg-gray-100 text-gray-700')}>
                          {ENTITY_LABELS[hold.hold_entity as ExternalEntity] || hold.hold_entity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200 font-medium">
                        {specificParty}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          {hold.container_count ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 max-w-[200px]">
                        {hold.hold_reason ? HOLD_REASON_LABELS[hold.hold_reason as HoldReason] : '—'}
                        {hold.hold_remark && (
                          <p className="text-gray-400 dark:text-gray-500 italic truncate mt-0.5">"{hold.hold_remark}"</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('text-sm tabular-nums', duration.color)}>{duration.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/shipments/${hold.shipment_id}`} className="text-blue-600 hover:underline text-xs whitespace-nowrap">
                          View →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* ── Volume by pull-out date ── */}
      {volume_by_date?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setVolumeOpen(o => !o)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
          >
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Shipment Volume</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {volumeOpen ? 'Active shipments grouped by pull-out date' : `${(volume_by_date as any[]).length} date group${(volume_by_date as any[]).length !== 1 ? 's' : ''} — click to expand`}
              </p>
            </div>
            <ChevronDown
              size={18}
              className={clsx('text-gray-400 transition-transform duration-200 shrink-0', volumeOpen && 'rotate-180')}
            />
          </button>

          {volumeOpen && (
            <div className="overflow-x-auto border-t dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                  <tr>
                    <SortableHeader label="Created"       column="created"    sort={volSort} onSort={volToggle} className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                    <SortableHeader label="Pull-out Date" column="pull_out"   sort={volSort} onSort={volToggle} className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                    <SortableHeader label="B/Ls"          column="bls"        sort={volSort} onSort={volToggle} className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                    <SortableHeader label="Containers"    column="containers" sort={volSort} onSort={volToggle} className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {sortedVolume.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{row.earliest_created ? formatDate(row.earliest_created) : '—'}</td>
                      <td className="px-5 py-3">
                        {row.pull_out_date ? (
                          <span className={clsx('font-medium', (() => {
                            const d = new Date(row.pull_out_date)
                            const days = Math.ceil((d.getTime() - Date.now()) / 86400000)
                            return days < 0 ? 'text-red-600 dark:text-red-400' : days <= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-100'
                          })())}>
                            {formatDate(row.pull_out_date)}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 italic text-xs">No date set</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-semibold text-gray-900 dark:text-white">{row.bl_count}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={clsx('font-semibold', row.container_total > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500')}>
                          {row.container_total > 0 ? row.container_total : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── All active shipments table ── */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">All Active Shipments</h2>
          <span className="text-xs text-gray-400">{shipments.length} shipments</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
              <tr>
                    <SortableHeader label="BL Number"    column="bl"         sort={shipSort} onSort={shipToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Invoice"      column="invoice"    sort={shipSort} onSort={shipToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Stage"        column="stage"      sort={shipSort} onSort={shipToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Containers"   column="containers" sort={shipSort} onSort={shipToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Pull-out Date" column="pull_out"  sort={shipSort} onSort={shipToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Days Active"  column="days"       sort={shipSort} onSort={shipToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Status"       column="status"     sort={shipSort} onSort={shipToggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <th />
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {shipments.length === 0 && (
                <tr><td colSpan={8} className="text-center text-gray-400 py-8 text-sm">No active shipments</td></tr>
              )}
              {sortedShipments.map((s: any) => {
                const hasDeclared = s.container_count != null
                const mismatch = hasDeclared && s.actual_containers < s.container_count
                return (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{s.bl_number}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.invoice_number}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs font-medium px-2.5 py-1 rounded-full', STAGE_COLORS[s.current_stage] || 'bg-gray-100 text-gray-700')}>
                        {STAGE_LABELS[s.current_stage as ShipmentStage]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(hasDeclared || s.actual_containers > 0) ? (
                        <span className={clsx(
                          'text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums',
                          mismatch
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        )}>
                          {s.actual_containers}{hasDeclared ? ` / ${s.container_count}` : ''}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatDate(s.pull_out_date)}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('font-medium', s.days_active > 14 ? 'text-red-600' : s.days_active > 7 ? 'text-amber-600' : 'text-gray-700')}>
                        {s.days_active}d
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {s.on_hold ? (
                        <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                          <AlertTriangle size={12} /> On Hold
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                          <Clock size={12} /> In Progress
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/shipments/${s.id}`} className="text-blue-600 hover:underline text-xs">View →</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
