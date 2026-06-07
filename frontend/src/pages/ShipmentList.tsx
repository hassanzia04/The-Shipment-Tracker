import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'
import { shipmentsApi } from '@/api/shipments'
import { authApi } from '@/api/auth'
import { ContainerView } from '@/components/ContainerView'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'
import {
  Plus, Search, AlertTriangle, Clock, Table2,
  ChevronLeft, ChevronRight, Save, X, Calendar,
  ChevronDown, ChevronUp, UserCheck, ListTodo, Box,
  CheckCircle, DollarSign, Pencil, FileSpreadsheet,
} from 'lucide-react'
import { STAGE_LABELS, TASK_TYPE_LABELS } from '@/types'
import type { ShipmentListItem, ShipmentStage, TaskType, TaskStatus } from '@/types'
import { formatDate } from '@/lib/dates'
import { useSortable } from '@/lib/sort'
import { SortableHeader } from '@/components/SortableHeader'
import clsx from 'clsx'

// ── Progress status indicator ─────────────────────────────────────────────────

function StatusDot({ status }: { status: TaskStatus | boolean | null | undefined }) {
  if (status === null || status === undefined) return <span className="w-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700 inline-block" />
  if (typeof status === 'boolean') return <span className={clsx('w-2 h-2 rounded-full inline-block', status ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700')} />
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-500',
    IN_PROGRESS: 'bg-blue-400',
    ON_HOLD: 'bg-red-500',
  }
  return <span className={clsx('w-2 h-2 rounded-full inline-block', colors[status] ?? 'bg-gray-300')} />
}

function firstName(name: string | null | undefined): string {
  return name ? name.split(' ')[0] : ''
}

function ProgressCell({ s }: { s: ShipmentListItem }) {
  const items: [string, TaskStatus | boolean | null, string | null][] = [
    ['Docs',   s.docs_approved,                       null],
    ['Permit', s.permit_status as TaskStatus | null,  s.permit_user],
    ['DO',     s.do_status     as TaskStatus | null,  s.do_user],
    ['Bayan',  s.bayan_status  as TaskStatus | null,  s.bayan_user],
  ]
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(([label, status, user]) => (
        <span key={label} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 leading-tight whitespace-nowrap">
          <StatusDot status={status} />
          {label}
          {user && (
            <span className="text-gray-400 dark:text-gray-500">· {firstName(user)}</span>
          )}
        </span>
      ))}
    </div>
  )
}

const PAGE_SIZE = 25

const STAGE_COLORS: Record<string, string> = {
  CUSTOMER:    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  FFD_REVIEW:  'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  TRANSPORT:   'bg-purple-100 text-purple-800',
  DC_TRANSPORT:'bg-orange-100 text-orange-800',
  COMPLETED:   'bg-green-100 text-green-800',
}

function urgency(pullOutDate: string | null): { label: string; color: string; days: number | null } {
  if (!pullOutDate) return { label: 'No date', color: 'text-gray-400', days: null }
  const date = parseISO(pullOutDate)
  if (!isValid(date)) return { label: 'Invalid date', color: 'text-gray-400', days: null }
  const days = differenceInCalendarDays(date, new Date())
  if (days < 0)  return { label: `${Math.abs(days)}d overdue`, color: 'text-red-600 font-semibold', days }
  if (days === 0) return { label: 'Today',                     color: 'text-red-500 font-semibold', days }
  if (days <= 3)  return { label: `${days}d left`,             color: 'text-amber-600 font-semibold', days }
  if (days <= 7)  return { label: `${days}d left`,             color: 'text-yellow-600', days }
  return                  { label: `${days}d left`,             color: 'text-gray-500', days }
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, total, onPage }: {
  page: number; totalPages: number; total: number; onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }
  return (
    <div className="flex items-center justify-between pt-4 border-t dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {total} shipment{total !== 1 ? 's' : ''} total
      </p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page === 1} className="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30">
          <ChevronLeft size={15} />
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e-${i}`} className="px-2 text-gray-400 text-sm">…</span>
          ) : (
            <button key={p} onClick={() => onPage(p as number)} className={clsx('min-w-[32px] h-8 rounded text-sm font-medium transition-colors', p === page ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700')}>
              {p}
            </button>
          )
        )}
        <button onClick={() => onPage(page + 1)} disabled={page === totalPages} className="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

// ── FFD: inline panel — open tasks + assign PRO members ──────────────────────

function InlineAssignPanel({ shipmentId, proUsers, onDone }: {
  shipmentId: string
  proUsers: { id: string; full_name: string }[]
  onDone: () => void
}) {
  const qc = useQueryClient()
  const { data: shipment, isLoading, refetch } = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => shipmentsApi.get(shipmentId).then(r => r.data),
  })
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  if (isLoading || !shipment) {
    return (
      <div className="px-5 py-4 bg-blue-50 dark:bg-blue-900/10 border-t dark:border-gray-700">
        <div className="h-4 w-48 bg-blue-100 dark:bg-blue-800 rounded animate-pulse" />
      </div>
    )
  }

  const tasks = shipment.tasks

  // Which tasks can be opened right now
  const permitDone  = tasks.some(t => t.task_type === 'PERMIT' && t.status === 'COMPLETED')
  const doDone      = tasks.some(t => t.task_type === 'DO'     && t.status === 'COMPLETED')
  const bayanExists = tasks.some(t => t.task_type === 'BAYAN')
  const bayanDone   = tasks.some(t => t.task_type === 'BAYAN'  && t.status === 'COMPLETED')
  const ccroExists  = tasks.some(t => t.task_type === 'CCRO')

  const canOpenBayan = !bayanExists
  const canOpenCcro  = doDone && bayanDone && !ccroExists

  // Unassigned PRO tasks ready for assignment
  const unassigned = tasks.filter(
    t => t.assigned_team === 'PRO' && t.status !== 'COMPLETED' && !t.assigned_to_id
  )

  const hasAnything = canOpenBayan || canOpenCcro || unassigned.length > 0

  async function openTask(type: 'bayan' | 'ccro') {
    setSaving(type)
    try {
      if (type === 'bayan') {
        await shipmentsApi.openBayan(shipmentId)
        toast.success('Bayan task opened')
      } else {
        await shipmentsApi.openCcro(shipmentId)
        toast.success('CCRO task opened')
      }
      qc.invalidateQueries({ queryKey: ['shipments'] })
      refetch()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to open task')
    } finally {
      setSaving(null)
    }
  }

  async function assign(taskId: string) {
    const assigneeId = selections[taskId]
    if (!assigneeId) { toast.error('Select a PRO member first'); return }
    setSaving(taskId)
    try {
      await shipmentsApi.assignTask(shipmentId, taskId, assigneeId)
      toast.success('Task assigned')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      refetch()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="px-5 py-4 bg-blue-50 dark:bg-blue-900/10 border-t dark:border-gray-700 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
          <UserCheck size={13} /> FFD Actions — BL: {shipment.bl_number}
        </p>
        <button onClick={onDone} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <X size={13} />
        </button>
      </div>

      {!hasAnything && (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          No actions available — all tasks are opened and assigned.
        </p>
      )}

      {/* ── Open tasks ── */}
      {(canOpenBayan || canOpenCcro) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Open tasks
          </p>
          <div className="flex flex-wrap gap-2">
            {canOpenBayan && (
              <button
                onClick={() => openTask('bayan')}
                disabled={saving === 'bayan'}
                className="flex items-center gap-1.5 text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
              >
                {saving === 'bayan' ? 'Opening…' : '+ Open Bayan task'}
              </button>
            )}
            {canOpenCcro && (
              <button
                onClick={() => openTask('ccro')}
                disabled={saving === 'ccro'}
                className="flex items-center gap-1.5 text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
              >
                {saving === 'ccro' ? 'Opening…' : '+ Open CCRO task'}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {canOpenBayan && 'Bayan task can be opened alongside Permit.'}
            {canOpenCcro  && 'DO & Bayan completed — CCRO is ready to open.'}
          </p>
        </div>
      )}

      {/* ── Assign PRO tasks ── */}
      {unassigned.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Assign to PRO member ({unassigned.length} unassigned)
          </p>
          {unassigned.map(task => (
            <div key={task.id} className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 w-20 shrink-0">
                {TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type}
              </span>
              <select
                value={selections[task.id] ?? ''}
                onChange={e => setSelections(prev => ({ ...prev, [task.id]: e.target.value }))}
                className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select PRO member…</option>
                {proUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
              <button
                onClick={() => assign(task.id)}
                disabled={!selections[task.id] || saving === task.id}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                {saving === task.id ? 'Saving…' : 'Assign'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Priority table (with optional FFD inline assign) ─────────────────────────

function PriorityTable({ shipments, page, totalPages, total, onPage, isFFD, isCustomer, isPRO, isDC, expandedId, onExpand, proUsers, onRefresh }: {
  shipments: ShipmentListItem[]
  page: number
  totalPages: number
  total: number
  onPage: (p: number) => void
  isFFD?: boolean
  isCustomer?: boolean
  isPRO?: boolean
  isDC?: boolean
  expandedId?: string | null
  onExpand?: (id: string | null) => void
  proUsers?: { id: string; full_name: string }[]
  onRefresh?: () => void
}) {
  const qc = useQueryClient()
  const offset = (page - 1) * PAGE_SIZE
  const colSpan = isFFD ? 10 : 9

  const [editingDateId, setEditingDateId] = useState<string | null>(null)
  const [dateValue, setDateValue] = useState('')
  const [savingDateId, setSavingDateId] = useState<string | null>(null)

  const [editingAmlsId, setEditingAmlsId] = useState<string | null>(null)
  const [amlsValue, setAmlsValue] = useState('')
  const [savingAmlsId, setSavingAmlsId] = useState<string | null>(null)

  async function saveAmlsJob(shipmentId: string) {
    setSavingAmlsId(shipmentId)
    try {
      await shipmentsApi.setAmlsJob(shipmentId, amlsValue.trim() || null)
      toast.success('AMLS Job# updated')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      setEditingAmlsId(null)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update AMLS Job#')
    } finally {
      setSavingAmlsId(null)
    }
  }

  async function savePullOutDate(shipmentId: string) {
    if (!dateValue) return
    setSavingDateId(shipmentId)
    try {
      await shipmentsApi.update(shipmentId, { pull_out_date: dateValue })
      toast.success('Pull-out date updated')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      setEditingDateId(null)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update date')
    } finally {
      setSavingDateId(null)
    }
  }

  const { sorted, sort, toggle } = useSortable(shipments, (s, col) => {
    switch (col) {
      case 'bl':       return s.bl_number
      case 'invoice':  return s.invoice_number
      case 'stage':    return s.current_stage
      case 'pull_out': return s.pull_out_date
      case 'time':     return s.pull_out_date
      default:         return null
    }
  })

  async function confirmPayment(shipmentId: string, taskId: string) {
    try {
      await shipmentsApi.completeTask(shipmentId, taskId)
      toast.success('Bayan payment confirmed')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      onRefresh?.()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to confirm payment')
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
            <tr>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">#</th>
              <SortableHeader label="BL Number"    column="bl"       sort={sort} onSort={toggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Invoice"      column="invoice"  sort={sort} onSort={toggle} className="hidden md:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label={isPRO ? 'My Task' : 'Stage'} column="stage" sort={sort} onSort={toggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">Progress</th>
              <SortableHeader label="Pull-out Date" column="pull_out" sort={sort} onSort={toggle} className="hidden md:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Time Left"    column="time"     sort={sort} onSort={toggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <th className="hidden lg:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">AMLS Job#</th>
              <th />
              {isFFD && <th />}
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {sorted.length === 0 && (
              <tr><td colSpan={colSpan} className="text-center text-gray-400 py-10 text-sm">No shipments found</td></tr>
            )}
            {sorted.map((s, idx) => {
              const u = urgency(s.pull_out_date)
              const isUrgent = u.days !== null && u.days <= 3
              const isOverdue = u.days !== null && u.days < 0
              const isExpanded = expandedId === s.id
              const showAssignBtn = isFFD && s.current_stage === 'IN_PROGRESS'
              const showPaymentBtn = isCustomer && s.bayan_payment_pending && s.bayan_payment_task_id

              return (
                <>
                  <tr
                    key={s.id}
                    className={clsx(
                      'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                      isOverdue && 'bg-red-50 dark:bg-red-900/10',
                      !isOverdue && isUrgent && 'bg-amber-50 dark:bg-amber-900/10',
                      isExpanded && '!bg-blue-50 dark:!bg-blue-900/10',
                    )}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        {isOverdue && <AlertTriangle size={14} className="text-red-500" />}
                        {!isOverdue && isUrgent && <Clock size={14} className="text-amber-500" />}
                        <span className="text-xs font-bold text-gray-400 dark:text-gray-500">#{offset + idx + 1}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-gray-900 dark:text-white">{s.bl_number}</td>
                    <td className="hidden md:table-cell px-3 py-3 text-gray-500 dark:text-gray-400">{s.invoice_number}</td>
                    <td className="px-3 py-3">
                      {isPRO && s.current_stage === 'IN_PROGRESS' ? (
                        <div className="flex flex-col gap-1">
                          {s.permit_status && s.permit_status !== 'COMPLETED' && (
                            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1',
                              s.permit_status === 'ON_HOLD'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                            )}>
                              {s.permit_status === 'ON_HOLD' && <AlertTriangle size={10} />}
                              Permit
                            </span>
                          )}
                          {s.bayan_status && s.bayan_status !== 'COMPLETED' && (
                            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1',
                              s.bayan_status === 'ON_HOLD'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                                : 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'
                            )}>
                              {s.bayan_status === 'ON_HOLD' && <AlertTriangle size={10} />}
                              Bayan
                            </span>
                          )}
                          {(!s.permit_status || s.permit_status === 'COMPLETED') && (!s.bayan_status || s.bayan_status === 'COMPLETED') && (
                            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STAGE_COLORS[s.current_stage])}>
                              {STAGE_LABELS[s.current_stage as ShipmentStage]}
                            </span>
                          )}
                        </div>
                      ) : isFFD && (s.do_revalidation_count > 0 || s.ccro_returned_count > 0) ? (
                        <div className="flex flex-col gap-1">
                          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STAGE_COLORS[s.current_stage])}>
                            {STAGE_LABELS[s.current_stage as ShipmentStage]}
                          </span>
                          {s.do_revalidation_count > 0 && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">
                              <AlertTriangle size={10} /> {s.do_revalidation_count} × DO Revalidation
                            </span>
                          )}
                          {s.ccro_returned_count > 0 && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                              <AlertTriangle size={10} /> {s.ccro_returned_count} × Returned to FFD
                            </span>
                          )}
                        </div>
                      ) : isDC && s.dc_health_cert_missing ? (
                        <div className="flex flex-col gap-1">
                          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STAGE_COLORS[s.current_stage])}>
                            {STAGE_LABELS[s.current_stage as ShipmentStage]}
                          </span>
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                            <AlertTriangle size={10} /> Health Cert Missing
                          </span>
                        </div>
                      ) : (
                        <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STAGE_COLORS[s.current_stage])}>
                          {STAGE_LABELS[s.current_stage as ShipmentStage]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <ProgressCell s={s} />
                    </td>
                    <td className="hidden md:table-cell px-3 py-3 text-gray-600 dark:text-gray-300">
                      {isCustomer && editingDateId === s.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            value={dateValue}
                            onChange={e => setDateValue(e.target.value)}
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') savePullOutDate(s.id)
                              if (e.key === 'Escape') setEditingDateId(null)
                            }}
                            className="text-xs border dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-32"
                          />
                          <button
                            onClick={() => savePullOutDate(s.id)}
                            disabled={!dateValue || savingDateId === s.id}
                            className="p-1 text-green-600 hover:text-green-700 disabled:opacity-40"
                            title="Save"
                          >
                            <CheckCircle size={14} />
                          </button>
                          <button
                            onClick={() => setEditingDateId(null)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group/date">
                          <span>{formatDate(s.pull_out_date)}</span>
                          {isCustomer && (
                            <button
                              onClick={() => { setEditingDateId(s.id); setDateValue(s.pull_out_date ?? '') }}
                              className="opacity-0 group-hover/date:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-blue-600"
                              title="Edit pull-out date"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={clsx('px-3 py-3 text-xs', u.color)}>{u.label}</td>
                    <td className="hidden lg:table-cell px-3 py-3">
                      {isFFD && editingAmlsId === s.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={amlsValue}
                            onChange={e => setAmlsValue(e.target.value)}
                            autoFocus
                            placeholder="Job#…"
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveAmlsJob(s.id)
                              if (e.key === 'Escape') setEditingAmlsId(null)
                            }}
                            className="text-xs border dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-24"
                          />
                          <button
                            onClick={() => saveAmlsJob(s.id)}
                            disabled={savingAmlsId === s.id}
                            className="p-1 text-green-600 hover:text-green-700 disabled:opacity-40"
                            title="Save"
                          >
                            <CheckCircle size={14} />
                          </button>
                          <button
                            onClick={() => setEditingAmlsId(null)}
                            disabled={savingAmlsId === s.id}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-40"
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group/amls">
                          <span className="text-xs text-gray-600 dark:text-gray-300">
                            {s.amls_job_number || <span className="text-gray-400">—</span>}
                          </span>
                          {isFFD && (
                            <button
                              onClick={() => { setEditingAmlsId(s.id); setAmlsValue(s.amls_job_number ?? '') }}
                              className="opacity-0 group-hover/amls:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-blue-600"
                              title="Edit AMLS Job#"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {showPaymentBtn && (
                          <button
                            onClick={() => confirmPayment(s.id, s.bayan_payment_task_id!)}
                            className="flex items-center gap-1 text-xs bg-amber-500 text-white px-2.5 py-1.5 rounded-lg hover:bg-amber-600 font-medium whitespace-nowrap"
                          >
                            <DollarSign size={11} /> Confirm Payment
                          </button>
                        )}
                        <Link to={`/shipments/${s.id}`} className="text-blue-600 hover:underline text-xs whitespace-nowrap">
                          View →
                        </Link>
                      </div>
                    </td>
                    {isFFD && (
                      <td className="px-3 py-3">
                        {showAssignBtn && (
                          <button
                            onClick={() => onExpand?.(isExpanded ? null : s.id)}
                            className={clsx(
                              'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors whitespace-nowrap',
                              isExpanded
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                            )}
                          >
                            <UserCheck size={12} />
                            Assign PRO
                            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {isExpanded && proUsers && (
                    <tr key={`${s.id}-panel`}>
                      <td colSpan={colSpan} className="p-0">
                        <InlineAssignPanel
                          shipmentId={s.id}
                          proUsers={proUsers}
                          onDone={() => onExpand?.(null)}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3">
        <Pagination page={page} totalPages={totalPages} total={total} onPage={onPage} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ShipmentList() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const isFFD        = user?.team === 'FFD'
  const isPRO        = user?.team === 'PRO'
  const isCustomer   = user?.team === 'CUSTOMER'
  const isTransport  = user?.team === 'TRANSPORT'
  const isDC         = user?.team === 'DC'
  const hasContainerView = !isPRO

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<ShipmentStage | '' | 'my_queue'>(() =>
    user?.team === 'MANAGEMENT' || user?.is_admin ? '' : 'my_queue'
  )
  const [page, setPage] = useState(1)
  const [view, setView] = useState<'priority' | 'containers'>(() =>
    isTransport || isDC ? 'containers' : 'priority'
  )
  const [missingDate, setMissingDate] = useState(false)
  const [amlsSearch, setAmlsSearch] = useState('')
  const [debouncedAmlsSearch, setDebouncedAmlsSearch] = useState('')
  const [missingAmls, setMissingAmls] = useState(false)
  const [pendingDates, setPendingDates] = useState<Record<string, string>>({})
  const [savingDates, setSavingDates] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // PRO users list — only needed for FFD inline assignment
  const { data: proUsers = [] } = useQuery({
    queryKey: ['team-members', 'PRO'],
    queryFn: () => authApi.listTeamMembers('PRO').then(r => r.data),
    enabled: isFFD,
  })

  const pendingCount = Object.keys(pendingDates).length

  function handleDateChange(id: string, date: string) {
    setPendingDates(prev => {
      const item = items.find(s => s.id === id)
      if (date === (item?.pull_out_date ?? '')) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: date }
    })
  }

  async function saveAllDates() {
    setSavingDates(true)
    const entries = Object.entries(pendingDates)
    const results = await Promise.allSettled(
      entries.map(([id, date]) => shipmentsApi.update(id, { pull_out_date: date }))
    )
    const failed    = results.filter(r => r.status === 'rejected').length
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    if (succeeded > 0) {
      qc.invalidateQueries({ queryKey: ['shipments'] })
      setPendingDates({})
      toast.success(`${succeeded} pull-out date${succeeded !== 1 ? 's' : ''} updated`)
    }
    if (failed > 0) toast.error(`${failed} update${failed !== 1 ? 's' : ''} failed`)
    setSavingDates(false)
  }

  async function handleBlExport() {
    try {
      const { data } = await shipmentsApi.blExport({
        search: debouncedSearch || undefined,
        stage: isMyQueue ? undefined : (stageFilter || undefined),
        my_queue: isMyQueue || undefined,
        missing_date: missingDate || undefined,
        amls_search: debouncedAmlsSearch || undefined,
        missing_amls: missingAmls || undefined,
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'shipments.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to export')
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAmlsSearch(amlsSearch), 300)
    return () => clearTimeout(t)
  }, [amlsSearch])

  useEffect(() => { setPage(1) }, [debouncedSearch, stageFilter, missingDate, debouncedAmlsSearch, missingAmls])

  const skip = (page - 1) * PAGE_SIZE
  const isMyQueue = stageFilter === 'my_queue'

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', skip, debouncedSearch, stageFilter, missingDate, debouncedAmlsSearch, missingAmls],
    queryFn: () => shipmentsApi.list({
      skip,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      stage: isMyQueue ? undefined : (stageFilter || undefined),
      my_queue: isMyQueue || undefined,
      missing_date: missingDate || undefined,
      amls_search: debouncedAmlsSearch || undefined,
      missing_amls: missingAmls || undefined,
    }).then(r => r.data),
    placeholderData: prev => prev,
  })

  const items      = data?.items ?? []
  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">All Shipments</h1>
        {user?.team === 'CUSTOMER' && (
          <Link to="/shipments/new" className="flex items-center gap-2 bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap">
            <Plus size={16} /> <span className="hidden sm:inline">New Shipment</span><span className="sm:hidden">New</span>
          </Link>
        )}
      </div>

      {/* PRO: My Tasks / All quick-filter chips */}
      {isPRO && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Show:</span>
          <button
            onClick={() => setStageFilter('my_queue')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              stageFilter === 'my_queue'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            )}
          >
            <ListTodo size={12} /> My Tasks
          </button>
          <button
            onClick={() => setStageFilter('')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              stageFilter === ''
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            )}
          >
            All Shipments
          </button>
        </div>
      )}

      {/* Controls — row 1: search + stage + view toggle */}
      <div className="flex flex-wrap gap-2 mb-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search BL or invoice…"
            className="w-full border dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Stage dropdown — only in B/L table view */}
        {!isPRO && view !== 'containers' && (
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value as ShipmentStage | '' | 'my_queue')}
            className="border dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {(user?.team !== 'MANAGEMENT' && !user?.is_admin) && (
              <option value="my_queue">My Queue</option>
            )}
            <option value="">All stages</option>
            {Object.entries(STAGE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        )}

        {hasContainerView && (
          <div className="flex border dark:border-gray-600 rounded-lg overflow-hidden ml-auto">
            <button
              onClick={() => setView('containers')}
              className={clsx('px-3 py-2 flex items-center gap-1.5 text-sm transition-colors',
                view === 'containers' ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
            >
              <Box size={15} /> <span className="hidden sm:inline">Containers</span>
            </button>
            <button
              onClick={() => setView('priority')}
              className={clsx('px-3 py-2 flex items-center gap-1.5 text-sm transition-colors',
                view === 'priority' ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
            >
              <Table2 size={15} /> <span className="hidden sm:inline">B/L Table</span>
            </button>
          </div>
        )}
      </div>

      {/* Controls — row 2: filters + export (B/L table only) */}
      {view !== 'containers' && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setMissingDate(v => !v)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap',
              missingDate
                ? 'bg-amber-500 text-white border-amber-500'
                : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            )}
          >
            <Calendar size={14} />
            No date
          </button>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={amlsSearch}
              onChange={e => setAmlsSearch(e.target.value)}
              placeholder="AMLS Job#…"
              className="w-36 border dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg pl-7 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={() => setMissingAmls(v => !v)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap',
              missingAmls
                ? 'bg-rose-500 text-white border-rose-500'
                : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            )}
          >
            No AMLS
          </button>

          <button
            onClick={handleBlExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors whitespace-nowrap ml-auto"
          >
            <FileSpreadsheet size={14} />
            Export to Excel
          </button>
        </div>
      )}

      {/* Legend for B/L table view */}
      {view !== 'containers' && (
        <div className="flex items-center gap-4 mb-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
          <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-red-500" /> Overdue</span>
          <span className="flex items-center gap-1"><Clock size={12} className="text-amber-500" /> Within 3 days</span>
          <span>Sorted by earliest pull-out date</span>
          <span className="flex items-center gap-1.5">
            <span className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              <span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />
            </span>
            Progress: Done · Active · On Hold · Not started
          </span>
        </div>
      )}

      {isLoading && !data ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-xl" />)}
        </div>
      ) : view === 'containers' ? (
        <ContainerView team={user!.team} />
      ) : (
        <PriorityTable
          shipments={items}
          page={page}
          totalPages={totalPages}
          total={total}
          onPage={setPage}
          isFFD={isFFD}
          isCustomer={isCustomer}
          isPRO={isPRO}
          isDC={isDC}
          expandedId={expandedId}
          onExpand={setExpandedId}
          proUsers={proUsers as { id: string; full_name: string }[]}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}

      {/* Sticky save bar for customer pull-out date edits */}
      {pendingCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 bg-gray-900 dark:bg-gray-700 text-white px-5 py-3 rounded-2xl shadow-xl border border-gray-700 dark:border-gray-600">
            <span className="text-sm">
              <span className="font-semibold text-blue-400">{pendingCount}</span>
              {' '}pull-out date{pendingCount !== 1 ? 's' : ''} edited
            </span>
            <button onClick={() => setPendingDates({})} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-800 dark:hover:bg-gray-600">
              <X size={13} /> Discard
            </button>
            <button onClick={saveAllDates} disabled={savingDates} className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-medium">
              <Save size={13} />
              {savingDates ? 'Saving…' : `Save ${pendingCount > 1 ? `${pendingCount} changes` : 'change'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
