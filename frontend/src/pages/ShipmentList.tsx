import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'
import { shipmentsApi } from '@/api/shipments'
import { authApi } from '@/api/auth'
import { documentsApi } from '@/api/documents'
import { ContainerView } from '@/components/ContainerView'
import { BulkBayanUploadModal } from '@/components/BulkBayanUploadModal'
import { BulkPermitUploadModal } from '@/components/BulkPermitUploadModal'
import { BulkDOUploadModal } from '@/components/BulkDOUploadModal'
import { BulkMiscUploadModal } from '@/components/BulkMiscUploadModal'
import { BulkCcroUploadModal } from '@/components/BulkCcroUploadModal'
import { BulkSalalahConfirmModal } from '@/components/BulkSalalahConfirmModal'
import { BulkAssignTaskModal } from '@/components/BulkAssignTaskModal'
import { BulkHoldModal } from '@/components/BulkHoldModal'
import { BulkReleaseHoldModal } from '@/components/BulkReleaseHoldModal'
import { BulkDownloadModal } from '@/components/BulkDownloadModal'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'
import {
  Plus, Search, AlertTriangle, Clock, Table2,
  ChevronLeft, ChevronRight, X, Calendar,
  ChevronDown, ChevronUp, UserCheck, ListTodo, Box,
  CheckCircle, DollarSign, Pencil, FileSpreadsheet, Files, Download, Loader2,
  SlidersHorizontal, Pause, Unlock, FileDown,
} from 'lucide-react'
import { STAGE_LABELS, TASK_TYPE_LABELS, ENTITY_LABELS, HOLD_REASON_LABELS, HOLD_REASON_MAP, TEAM_HOLD_PERMISSIONS, isCustomerTeam } from '@/types'
import { companiesApi } from '@/api/companies'
import type { ShipmentListItem, ShipmentStage, TaskType, TaskStatus, Team, ExternalEntity, HoldReason } from '@/types'
import type { SortState } from '@/lib/sort'
import { formatDate, formatDateTime } from '@/lib/dates'
import { SortableHeader } from '@/components/SortableHeader'
import { ColumnFilterPopover } from '@/components/ColumnFilterPopover'
import { CopyButton } from '@/components/CopyButton'
import { CustomerFocusBar } from '@/components/CustomerFocusBar'
import clsx from 'clsx'

const ALL_COLUMNS = [
  { key: 'invoice',              label: 'Invoice' },
  { key: 'consignee',            label: 'Consignee' },
  { key: 'company',              label: 'Customer' },
  { key: 'port',                 label: 'Port of Loading' },
  { key: 'offloading_location',  label: 'Offloading Location' },
  { key: 'bayan_type',           label: 'Bayan Type' },
  { key: 'shipping_line',        label: 'Shipping Line' },
  { key: 'stage',      label: 'Stage' },
  { key: 'progress',   label: 'Progress' },
  { key: 'pull_out',   label: 'Planned Pull Out' },
  { key: 'eta',        label: 'ETA to Port' },
  { key: 'do_validity',label: 'DO Validity' },
  { key: 'amls',       label: 'AMLS Job#' },
  { key: 'permit_no',  label: 'Permit No' },
] as const

// Columns hidden on mobile by default (previously handled by Tailwind responsive classes)
const MOBILE_DEFAULT_HIDDEN = new Set(['invoice', 'consignee', 'company', 'port', 'offloading_location', 'bayan_type', 'shipping_line', 'pull_out', 'eta', 'do_validity', 'amls', 'permit_no'])

// ── Bulk-selection action bar ─────────────────────────────────────────────────
// Desktop: centered floating pill. Mobile: full-width dock above the bottom nav
// with the count + Clear pinned and the actions in a horizontally swipeable row.

function BulkActionBar({ count, countClass, onClear, children }: {
  count: number
  countClass: string
  onClear: () => void
  children: ReactNode
}) {
  const label = (
    <span className="text-sm whitespace-nowrap">
      <span className={clsx('font-semibold', countClass)}>{count}</span>
      {' '}shipment{count !== 1 ? 's' : ''} selected
    </span>
  )
  const clearBtn = (visibility: string) => (
    <button
      onClick={onClear}
      className={clsx('items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-800 dark:hover:bg-gray-600 shrink-0', visibility)}
    >
      <X size={13} /> Clear
    </button>
  )
  return (
    <>
      {/* In-flow spacer so the fixed dock never hides the last rows when scrolled to the bottom */}
      <div aria-hidden className="h-32 lg:h-20" />
      <div className="fixed z-50 inset-x-2 bottom-[4.5rem] lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2 lg:bottom-6 pointer-events-none">
        <div className="pointer-events-auto bg-gray-900 dark:bg-gray-700 text-white border border-gray-700 dark:border-gray-600 rounded-xl lg:rounded-2xl shadow-xl px-3 py-2.5 lg:px-5 lg:py-3">
          <div className="flex lg:hidden items-center justify-between gap-2 mb-2">
            {label}
            {clearBtn('flex')}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto lg:overflow-x-visible lg:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="hidden lg:block shrink-0">{label}</span>
            {children}
            {clearBtn('hidden lg:flex')}
          </div>
        </div>
      </div>
    </>
  )
}

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
  const today = new Date().toISOString().slice(0, 10)
  const isDoExpired = !!s.do_validity_date && s.do_validity_date < today
  const items: [string, TaskStatus | boolean | null, string | null][] = [
    ['Docs',   s.docs_approved,                       null],
    ['Permit', s.permit_status as TaskStatus | null,  s.permit_user],
    ['DO',     s.do_status     as TaskStatus | null,  s.do_user],
    ['Bayan',  s.bayan_status  as TaskStatus | null,  s.bayan_user],
  ]
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(([label, status, user]) => (
        <span key={label} className={clsx('flex items-center gap-1 text-[10px] leading-tight whitespace-nowrap', label === 'DO' && isDoExpired ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400')}>
          {label === 'DO' && isDoExpired
            ? <span className="w-2 h-2 rounded-full inline-block bg-amber-500" />
            : <StatusDot status={status} />
          }
          {label === 'DO' && isDoExpired ? 'DO Expired' : label}
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

function doValidityStyle(date: string | null): { color: string } {
  if (!date) return { color: 'text-gray-400' }
  const d = parseISO(date)
  if (!isValid(d)) return { color: 'text-gray-400' }
  const days = differenceInCalendarDays(d, new Date())
  if (days < 0)  return { color: 'text-red-600 font-semibold' }
  if (days <= 3)  return { color: 'text-amber-600 font-semibold' }
  return { color: 'text-gray-600 dark:text-gray-300' }
}

function urgency(pullOutDate: string | null): { label: string; color: string; days: number | null } {
  if (!pullOutDate) return { label: 'No Pull Out Date', color: 'text-gray-400', days: null }
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

// ── FFD: inline panel — send docs back to customer ───────────────────────────

function InlineSendBackPanel({ shipmentId, blNumber, onDone }: {
  shipmentId: string
  blNumber: string
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  async function submit() {
    if (!remark.trim()) { toast.error('Please enter a reason'); return }
    setSaving(true)
    try {
      await shipmentsApi.rejectDocs(shipmentId, remark.trim())
      toast.success('Docs sent back to customer')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to send back')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-5 py-4 bg-red-50 dark:bg-red-900/10 border-t dark:border-gray-700 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-red-700 dark:text-red-400">
          Send docs back — BL: {blNumber}
        </p>
        <button onClick={onDone} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <X size={13} />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={remark}
        onChange={e => setRemark(e.target.value)}
        placeholder="Reason for sending back…"
        rows={4}
        onKeyDown={e => { if (e.key === 'Escape') onDone() }}
        className="w-full text-xs border dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-red-400 resize-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving || !remark.trim()}
          className="flex items-center gap-1.5 text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
        >
          {saving ? 'Sending…' : 'Send Back'}
        </button>
        <button onClick={onDone} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1.5">
          Cancel
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

// ── FFD / PRO: inline panel — hold management ────────────────────────────────

function InlineHoldPanel({ shipmentId, userTeam, onDone }: {
  shipmentId: string
  userTeam: Team
  onDone: () => void
}) {
  const qc = useQueryClient()
  const { data: shipment, isLoading } = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => shipmentsApi.get(shipmentId).then(r => r.data),
  })
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null)
  const [entity, setEntity] = useState<ExternalEntity | ''>('')
  const [reason, setReason] = useState<HoldReason | ''>('')
  const [remark, setRemark] = useState('')
  const [releasingTaskId, setReleasingTaskId] = useState<string | null>(null)
  const [releaseRemark, setReleaseRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (isLoading || !shipment) {
    return (
      <div className="px-5 py-4 bg-orange-50 dark:bg-orange-900/10 border-t dark:border-gray-700">
        <div className="h-4 w-48 bg-orange-100 dark:bg-orange-800 rounded animate-pulse" />
      </div>
    )
  }

  const isFFD = userTeam === 'FFD'
  const allowedEntities = TEAM_HOLD_PERMISSIONS[userTeam] ?? []
  const TARGET_TYPES: TaskType[] = ['PERMIT', 'BAYAN', 'DO', 'CCRO']
  const activeTasks = shipment.tasks.filter(
    t => TARGET_TYPES.includes(t.task_type) && t.status !== 'COMPLETED'
  )
  const visibleTasks = isFFD
    ? activeTasks
    : activeTasks.filter(t => t.task_type === 'PERMIT' || t.task_type === 'BAYAN')

  async function handleAssignHold(taskId: string) {
    if (!entity || !reason) return
    if ((entity === 'OTHER' || reason === 'OTHER') && !remark.trim()) {
      toast.error('Remark is required when selecting Other')
      return
    }
    setSubmitting(true)
    try {
      await shipmentsApi.assignHold(shipmentId, taskId, { hold_entity: entity, hold_reason: reason, hold_remark: remark })
      toast.success('Hold assigned')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['shipment', shipmentId] })
      setAssigningTaskId(null)
      setEntity(''); setReason(''); setRemark('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign hold')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReleaseHold(taskId: string) {
    setSubmitting(true)
    try {
      await shipmentsApi.releaseHold(shipmentId, taskId, releaseRemark)
      toast.success('Hold released')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['shipment', shipmentId] })
      setReleasingTaskId(null)
      setReleaseRemark('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to release hold')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="px-5 py-4 bg-orange-50 dark:bg-orange-900/10 border-t dark:border-gray-700 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
          <Pause size={13} /> Hold Management — BL: {shipment.bl_number}
        </p>
        <button onClick={onDone} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <X size={13} />
        </button>
      </div>

      {visibleTasks.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          No active tasks available for hold management.
        </p>
      )}

      {visibleTasks.map(task => (
        <div key={task.id} className="bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {TASK_TYPE_LABELS[task.task_type as TaskType]}
            </span>
            <span className={clsx(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              task.status === 'ON_HOLD'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
            )}>
              {task.status === 'ON_HOLD' ? 'On Hold' : 'In Progress'}
            </span>
          </div>

          {task.status === 'ON_HOLD' && (
            <div className="text-xs bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 rounded p-2 space-y-0.5">
              {task.hold_entity && <p>Entity: {ENTITY_LABELS[task.hold_entity]}</p>}
              {task.hold_reason && <p>Reason: {HOLD_REASON_LABELS[task.hold_reason]}</p>}
              {task.hold_remark && <p className="italic">"{task.hold_remark}"</p>}
            </div>
          )}

          {task.status === 'ON_HOLD' && releasingTaskId !== task.id && (
            <button
              onClick={() => { setReleasingTaskId(task.id); setReleaseRemark('') }}
              className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700"
            >
              <Unlock size={11} /> Release Hold
            </button>
          )}

          {task.status === 'ON_HOLD' && releasingTaskId === task.id && (
            <div className="space-y-2">
              <textarea
                value={releaseRemark}
                onChange={e => setReleaseRemark(e.target.value)}
                placeholder="Describe how the hold was resolved (optional)…"
                className="w-full text-xs border dark:border-gray-600 rounded p-2 h-16 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleReleaseHold(task.id)}
                  disabled={submitting}
                  className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {submitting ? 'Releasing…' : 'Confirm Release'}
                </button>
                <button
                  onClick={() => setReleasingTaskId(null)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {task.status === 'IN_PROGRESS' && assigningTaskId !== task.id && (
            <button
              onClick={() => { setAssigningTaskId(task.id); setEntity(''); setReason(''); setRemark('') }}
              className="flex items-center gap-1 text-xs border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20"
            >
              <AlertTriangle size={11} /> Assign Hold
            </button>
          )}

          {task.status === 'IN_PROGRESS' && assigningTaskId === task.id && (
            <div className="space-y-2">
              <select
                value={entity}
                onChange={e => { setEntity(e.target.value as ExternalEntity); setReason('') }}
                className="w-full text-xs border dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select entity…</option>
                {allowedEntities.map(ent => (
                  <option key={ent} value={ent}>{ENTITY_LABELS[ent]}</option>
                ))}
              </select>
              {entity && (
                <select
                  value={reason}
                  onChange={e => setReason(e.target.value as HoldReason)}
                  className="w-full text-xs border dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select reason…</option>
                  {HOLD_REASON_MAP[entity as ExternalEntity].map(r => (
                    <option key={r} value={r}>{HOLD_REASON_LABELS[r]}</option>
                  ))}
                </select>
              )}
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder={entity === 'OTHER' || reason === 'OTHER' ? 'Describe the issue (required)…' : 'Add remarks (optional)…'}
                className="w-full text-xs border dark:border-gray-600 rounded p-2 h-16 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAssignHold(task.id)}
                  disabled={submitting || !entity || !reason}
                  className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded hover:bg-amber-600 disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Assign Hold'}
                </button>
                <button
                  onClick={() => setAssigningTaskId(null)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Priority table (with optional FFD inline assign) ─────────────────────────

interface ColFilters {
  bl: string
  consignee: string
  company: string
  port: string
  offloading: string
  bayan_type: string
  shipping_line: string
  stage: string
  pull_out_from: string
  pull_out_to: string
  eta_from: string
  eta_to: string
  do_validity_from: string
  do_validity_to: string
  amls: string
  permit: string
}

function PriorityTable({ shipments, page, totalPages, total, onPage, isFFD, isCustomer, isPRO, isDC, isTransport, isAdmin, currentUserId, expandedId, onExpand, proUsers, onRefresh, sort, onSort, hiddenCols = new Set(), isMobile = false, historical = false, colFilters, onColFilter, showCompanyCol = false, companyOptions = [] }: {
  shipments: ShipmentListItem[]
  page: number
  totalPages: number
  total: number
  onPage: (p: number) => void
  isFFD?: boolean
  isCustomer?: boolean
  isPRO?: boolean
  isDC?: boolean
  isTransport?: boolean
  isAdmin?: boolean
  currentUserId?: string
  expandedId?: string | null
  onExpand?: (id: string | null) => void
  proUsers?: { id: string; full_name: string }[]
  onRefresh?: () => void
  sort: SortState
  onSort: (col: string) => void
  hiddenCols?: Set<string>
  isMobile?: boolean
  historical?: boolean
  colFilters: ColFilters
  onColFilter: (key: keyof ColFilters, value: string) => void
  showCompanyCol?: boolean
  companyOptions?: { value: string; label: string }[]
}) {
  const qc = useQueryClient()
  const offset = (page - 1) * PAGE_SIZE
  const colSpan = (isFFD ? 16 : (isCustomer || isPRO) ? 16 : isAdmin ? 16 : (isDC || isTransport) ? 16 : 15) + (showCompanyCol ? 1 : 0)

  function colCls(key: string, whenVisible: string): string {
    if (hiddenCols.has(key)) return 'hidden'
    // On mobile, strip Tailwind responsive hiding prefixes so hiddenCols controls visibility
    if (isMobile) return whenVisible.replace(/hidden (?:sm|md|lg|xl|2xl):table-cell\s*/g, '')
    return whenVisible
  }
  const [editingDateId, setEditingDateId] = useState<string | null>(null)
  const [dateValue, setDateValue] = useState('')
  const [savingDateId, setSavingDateId] = useState<string | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDate, setBulkDate] = useState('')
  const [savingBulk, setSavingBulk] = useState(false)

  const [selectedProIds, setSelectedProIds] = useState<Set<string>>(new Set())
  const [savingBulkPayment, setSavingBulkPayment] = useState(false)

  const [selectedFFDIds, setSelectedFFDIds] = useState<Set<string>>(new Set())
  const [savingBulkOpenBayan, setSavingBulkOpenBayan] = useState(false)
  const [showBulkAssignBayan, setShowBulkAssignBayan] = useState(false)
  const [showBulkAssignPermit, setShowBulkAssignPermit] = useState(false)
  const [showBulkHoldFFD, setShowBulkHoldFFD] = useState(false)
  const [showBulkReleaseHoldFFD, setShowBulkReleaseHoldFFD] = useState(false)
  const [showBulkHoldPRO, setShowBulkHoldPRO] = useState(false)
  const [showBulkReleaseHoldPRO, setShowBulkReleaseHoldPRO] = useState(false)

  const [selectedAdminIds, setSelectedAdminIds] = useState<Set<string>>(new Set())
  const [savingBulkDelete, setSavingBulkDelete] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  // Shared between Transport and DC — a user belongs to exactly one team, so these never collide
  const [selectedOpsIds, setSelectedOpsIds] = useState<Set<string>>(new Set())

  const [showBulkDownload, setShowBulkDownload] = useState(false)
  const [bulkDownloadIds, setBulkDownloadIds] = useState<string[]>([])

  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set())

  async function handleApproveDocs(shipmentId: string) {
    setApprovingIds(prev => new Set(prev).add(shipmentId))
    try {
      await shipmentsApi.approveDocs(shipmentId)
      toast.success('Documents approved')
      qc.invalidateQueries({ queryKey: ['shipments'] })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to approve docs')
    } finally {
      setApprovingIds(prev => { const next = new Set(prev); next.delete(shipmentId); return next })
    }
  }

  async function handleDownloadAll(shipmentId: string, blNumber: string) {
    setDownloadingIds(prev => new Set(prev).add(shipmentId))
    try {
      const { data } = await documentsApi.downloadAll(shipmentId)
      const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `BL_${blNumber}_documents.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download documents')
    } finally {
      setDownloadingIds(prev => { const next = new Set(prev); next.delete(shipmentId); return next })
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll(rows: ShipmentListItem[]) {
    setSelectedIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(s => s.id)))
  }

  async function saveBulkDate() {
    if (!bulkDate || selectedIds.size === 0) return
    setSavingBulk(true)
    try {
      await shipmentsApi.bulkUpdatePullOutDate(Array.from(selectedIds), bulkDate)
      qc.invalidateQueries({ queryKey: ['shipments'] })
      const count = selectedIds.size
      setSelectedIds(new Set())
      setBulkDate('')
      toast.success(`${count} pull-out date${count !== 1 ? 's' : ''} updated`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update dates')
    } finally {
      setSavingBulk(false)
    }
  }

  function toggleSelectPro(id: string) {
    setSelectedProIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAllPro(rows: ShipmentListItem[]) {
    setSelectedProIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(s => s.id)))
  }

  function toggleSelectFFD(id: string) {
    setSelectedFFDIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAllFFD(rows: ShipmentListItem[]) {
    setSelectedFFDIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(s => s.id)))
  }

  async function handleBulkOpenBayan() {
    if (selectedFFDIds.size === 0) return
    setSavingBulkOpenBayan(true)
    try {
      await shipmentsApi.bulkOpenBayan(Array.from(selectedFFDIds))
      qc.invalidateQueries({ queryKey: ['shipments'] })
      const count = selectedFFDIds.size
      setSelectedFFDIds(new Set())
      toast.success(`Bayan tasks opened for ${count} shipment${count !== 1 ? 's' : ''}`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to open Bayan tasks')
    } finally {
      setSavingBulkOpenBayan(false)
    }
  }

  function toggleSelectAdmin(id: string) {
    setSelectedAdminIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAllAdmin(rows: ShipmentListItem[]) {
    setSelectedAdminIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(s => s.id)))
  }

  function toggleSelectOps(id: string) {
    setSelectedOpsIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAllOps(rows: ShipmentListItem[]) {
    setSelectedOpsIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(s => s.id)))
  }

  async function handleBulkDelete() {
    if (selectedAdminIds.size === 0) return
    setSavingBulkDelete(true)
    try {
      await shipmentsApi.bulkDelete(Array.from(selectedAdminIds))
      qc.invalidateQueries({ queryKey: ['shipments'] })
      const count = selectedAdminIds.size
      setSelectedAdminIds(new Set())
      setConfirmBulkDelete(false)
      toast.success(`${count} shipment${count !== 1 ? 's' : ''} deleted`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to delete shipments')
    } finally {
      setSavingBulkDelete(false)
    }
  }

  async function submitBulkBayanPayment() {
    if (selectedProIds.size === 0) return
    setSavingBulkPayment(true)
    try {
      await shipmentsApi.bulkRequestBayanPayment(Array.from(selectedProIds))
      qc.invalidateQueries({ queryKey: ['shipments'] })
      const count = selectedProIds.size
      setSelectedProIds(new Set())
      toast.success(`Payment requested for ${count} shipment${count !== 1 ? 's' : ''}`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to send payment request')
    } finally {
      setSavingBulkPayment(false)
    }
  }

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

  const [editingPermitId, setEditingPermitId] = useState<string | null>(null)
  const [permitRefValue, setPermitRefValue] = useState('')
  const [savingPermitId, setSavingPermitId] = useState<string | null>(null)

  // Permit complete from the list: enabled once the permit number is filled, inline confirm
  const [confirmPermitCompleteId, setConfirmPermitCompleteId] = useState<string | null>(null)
  const [savingPermitCompleteId, setSavingPermitCompleteId] = useState<string | null>(null)

  async function completePermitTask(s: ShipmentListItem) {
    if (!s.permit_task_id) return
    setSavingPermitCompleteId(s.id)
    try {
      await shipmentsApi.completeTask(s.id, s.permit_task_id)
      toast.success(`Permit task completed — ${s.bl_number}`)
      setConfirmPermitCompleteId(null)
      qc.invalidateQueries({ queryKey: ['shipments'] })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to complete permit task')
    } finally {
      setSavingPermitCompleteId(null)
    }
  }

  // Permit "not required" from the list: confirm inline, then fire after a 5s undo window
  const [confirmPermitNaId, setConfirmPermitNaId] = useState<string | null>(null)
  const [pendingPermitNaIds, setPendingPermitNaIds] = useState<Set<string>>(new Set())
  const pendingPermitNaRef = useRef<Map<string, { timer: number; fire: () => void }>>(new Map())

  useEffect(() => () => {
    // Flush pending completions on unmount so a confirmed action isn't silently lost
    pendingPermitNaRef.current.forEach(({ timer, fire }) => { clearTimeout(timer); fire() })
    pendingPermitNaRef.current.clear()
  }, [])

  function schedulePermitNotRequired(s: ShipmentListItem) {
    const taskId = s.permit_task_id
    if (!taskId || pendingPermitNaRef.current.has(s.id)) return
    setConfirmPermitNaId(null)
    setPendingPermitNaIds(prev => new Set(prev).add(s.id))

    const clearPending = () => {
      pendingPermitNaRef.current.delete(s.id)
      setPendingPermitNaIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    }
    const fire = () => {
      clearPending()
      shipmentsApi.completeTask(s.id, taskId, undefined, true)
        .then(() => {
          toast.success(`Permit marked not required — ${s.bl_number}`)
          qc.invalidateQueries({ queryKey: ['shipments'] })
        })
        .catch((e: any) => toast.error(e.response?.data?.detail || `Failed to mark permit not required — ${s.bl_number}`))
    }
    const toastId = toast(
      t => (
        <span className="flex items-center gap-3">
          <span>Permit not required — {s.bl_number}</span>
          <button
            onClick={() => {
              const pending = pendingPermitNaRef.current.get(s.id)
              if (pending) clearTimeout(pending.timer)
              clearPending()
              toast.dismiss(t.id)
            }}
            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Undo
          </button>
        </span>
      ),
      { duration: 5000 }
    )
    const timer = window.setTimeout(() => { toast.dismiss(toastId); fire() }, 5000)
    pendingPermitNaRef.current.set(s.id, { timer, fire })
  }

  const [holdPanelId, setHoldPanelId] = useState<string | null>(null)

  async function savePermitRef(shipmentId: string) {
    setSavingPermitId(shipmentId)
    try {
      await shipmentsApi.setPermitRef(shipmentId, permitRefValue.trim() || null)
      toast.success('Permit No updated')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      setEditingPermitId(null)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update Permit No')
    } finally {
      setSavingPermitId(null)
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

  const pendingPayments = isCustomer
    ? shipments.filter(s => s.bayan_payment_pending && s.bayan_payment_task_id)
    : []
  const displaySorted = isCustomer && pendingPayments.length > 0
    ? [...shipments].sort((a, b) => {
        if (a.bayan_payment_pending && !b.bayan_payment_pending) return -1
        if (!a.bayan_payment_pending && b.bayan_payment_pending) return 1
        return 0
      })
    : shipments

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

      {/* Payment callout — visible above the table so mobile customers never need to scroll right */}
      {isCustomer && pendingPayments.length > 0 && (
        <div className="border-b dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <DollarSign size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Bayan Payment Required — {pendingPayments.length} BL{pendingPayments.length !== 1 ? 's' : ''} awaiting your confirmation
            </p>
          </div>
          {pendingPayments.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-amber-200 dark:border-amber-700">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.bl_number}</p>
                {s.invoice_number && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{s.invoice_number}</p>}
              </div>
              <button
                onClick={() => confirmPayment(s.id, s.bayan_payment_task_id!)}
                className="flex items-center gap-1.5 text-xs bg-amber-500 text-white px-3 py-2 rounded-lg hover:bg-amber-600 font-medium whitespace-nowrap shrink-0"
              >
                <DollarSign size={12} /> Confirm Payment
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto md:overflow-auto md:max-h-[calc(100vh-280px)]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 sticky top-0 z-20">
            <tr>
              {isCustomer && !historical && (
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === displaySorted.length && displaySorted.length > 0}
                    onChange={() => toggleSelectAll(displaySorted)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
              )}
              {isPRO && !historical && (
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedProIds.size === displaySorted.length && displaySorted.length > 0}
                    onChange={() => toggleSelectAllPro(displaySorted)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
              )}
              {isFFD && !historical && (
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedFFDIds.size === displaySorted.length && displaySorted.length > 0}
                    onChange={() => toggleSelectAllFFD(displaySorted)}
                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                </th>
              )}
              {isAdmin && !historical && (
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedAdminIds.size === displaySorted.length && displaySorted.length > 0}
                    onChange={() => toggleSelectAllAdmin(displaySorted)}
                    className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                  />
                </th>
              )}
              {(isDC || isTransport) && !historical && (
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedOpsIds.size === displaySorted.length && displaySorted.length > 0}
                    onChange={() => toggleSelectAllOps(displaySorted)}
                    className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                  />
                </th>
              )}
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">#</th>
              <SortableHeader label="BL Number" column="bl" sort={sort} onSort={onSort} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                filter={<ColumnFilterPopover filter={{ type: 'text', value: colFilters.bl, onChange: v => onColFilter('bl', v), placeholder: 'Filter BL…' }} />}
              />
              <SortableHeader label="Invoice" column="invoice" sort={sort} onSort={onSort} className={colCls('invoice', 'hidden md:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')} />
              <th className={colCls('consignee', 'hidden lg:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                <div className="flex items-center gap-1">Consignee<ColumnFilterPopover filter={{ type: 'text', value: colFilters.consignee, onChange: v => onColFilter('consignee', v), placeholder: 'Filter consignee…' }} /></div>
              </th>
              {showCompanyCol && (
                <th className={colCls('company', 'hidden lg:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                  <div className="flex items-center gap-1">Customer<ColumnFilterPopover filter={{ type: 'select', value: colFilters.company, onChange: v => onColFilter('company', v), options: companyOptions, allLabel: 'All customers' }} /></div>
                </th>
              )}
              <th className={colCls('port', 'hidden xl:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                <div className="flex items-center gap-1">Port of Loading<ColumnFilterPopover filter={{ type: 'text', value: colFilters.port, onChange: v => onColFilter('port', v), placeholder: 'Filter port…' }} /></div>
              </th>
              <th className={colCls('offloading_location', 'hidden xl:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                <div className="flex items-center gap-1">Offloading Location<ColumnFilterPopover filter={{ type: 'text', value: colFilters.offloading, onChange: v => onColFilter('offloading', v), placeholder: 'Filter location…' }} /></div>
              </th>
              <th className={colCls('bayan_type', 'hidden xl:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                <div className="flex items-center gap-1">Bayan Type<ColumnFilterPopover filter={{ type: 'text', value: colFilters.bayan_type, onChange: v => onColFilter('bayan_type', v), placeholder: 'Filter type…' }} /></div>
              </th>
              <th className={colCls('shipping_line', 'hidden xl:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                <div className="flex items-center gap-1">Shipping Line<ColumnFilterPopover filter={{ type: 'text', value: colFilters.shipping_line, onChange: v => onColFilter('shipping_line', v), placeholder: 'Filter line…' }} /></div>
              </th>
              <SortableHeader label={isPRO ? 'My Task' : 'Stage'} column="stage" sort={sort} onSort={onSort} className={colCls('stage', 'px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')}
                filter={!isPRO && <ColumnFilterPopover filter={{ type: 'select', value: colFilters.stage, onChange: v => onColFilter('stage', v), options: Object.entries(STAGE_LABELS).filter(([v]) => v !== 'COMPLETED').map(([value, label]) => ({ value, label })), allLabel: 'All stages' }} />}
              />
              <th className={colCls('progress', 'text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>Progress</th>
              <SortableHeader label={historical ? 'Offloading Date' : 'Planned Pull out'} column="pull_out" sort={sort} onSort={onSort} className={colCls('pull_out', 'hidden md:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')}
                filter={!historical && <ColumnFilterPopover filter={{ type: 'daterange', from: colFilters.pull_out_from, to: colFilters.pull_out_to, onFromChange: v => onColFilter('pull_out_from', v), onToChange: v => onColFilter('pull_out_to', v) }} />}
              />
              <SortableHeader label="ETA to Port" column="eta" sort={sort} onSort={onSort} className={colCls('eta', 'hidden xl:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')}
                filter={<ColumnFilterPopover filter={{ type: 'daterange', from: colFilters.eta_from, to: colFilters.eta_to, onFromChange: v => onColFilter('eta_from', v), onToChange: v => onColFilter('eta_to', v) }} />}
              />
              <SortableHeader label="DO Validity" column="do_validity" sort={sort} onSort={onSort} className={colCls('do_validity', 'hidden xl:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')}
                filter={<ColumnFilterPopover filter={{ type: 'daterange', from: colFilters.do_validity_from, to: colFilters.do_validity_to, onFromChange: v => onColFilter('do_validity_from', v), onToChange: v => onColFilter('do_validity_to', v) }} />}
              />
              <th className={colCls('amls', 'hidden lg:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                <div className="flex items-center gap-1">AMLS Job#<ColumnFilterPopover filter={{ type: 'text', value: colFilters.amls, onChange: v => onColFilter('amls', v), placeholder: 'Filter AMLS…' }} /></div>
              </th>
              <th className={colCls('permit_no', 'hidden lg:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>
                <div className="flex items-center gap-1">Permit No<ColumnFilterPopover filter={{ type: 'text', value: colFilters.permit, onChange: v => onColFilter('permit', v), placeholder: 'Filter permit…' }} /></div>
              </th>
              <th />
              {isFFD && <th />}
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {displaySorted.length === 0 && (
              <tr><td colSpan={colSpan} className="text-center text-gray-400 py-10 text-sm">No shipments found</td></tr>
            )}
            {displaySorted.map((s, idx) => {
              const u = historical ? { days: null } : urgency(s.pull_out_date)
              const isUrgent = !historical && u.days !== null && u.days <= 3
              const isOverdue = !historical && u.days !== null && u.days < 0
              const isExpanded = expandedId === s.id
              const showAssignBtn = !historical && isFFD && s.current_stage === 'IN_PROGRESS'
              const showReviewBtn = !historical && isFFD && s.current_stage === 'FFD_REVIEW'
              const showPaymentBtn = !historical && isCustomer && s.bayan_payment_pending && s.bayan_payment_task_id
              const hasActiveHold = s.permit_status === 'ON_HOLD' || s.do_status === 'ON_HOLD' || s.bayan_status === 'ON_HOLD' || s.ccro_status === 'ON_HOLD'
              const showHoldBtn = !historical && s.current_stage === 'IN_PROGRESS' && (
                isFFD || (isPRO && (
                  (s.permit_status && s.permit_status !== 'COMPLETED') ||
                  (s.bayan_status && s.bayan_status !== 'COMPLETED')
                ))
              )

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
                    {isCustomer && !historical && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                    )}
                    {isPRO && !historical && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedProIds.has(s.id)}
                          onChange={() => toggleSelectPro(s.id)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                    )}
                    {isFFD && !historical && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedFFDIds.has(s.id)}
                          onChange={() => toggleSelectFFD(s.id)}
                          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                        />
                      </td>
                    )}
                    {isAdmin && !historical && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedAdminIds.has(s.id)}
                          onChange={() => toggleSelectAdmin(s.id)}
                          className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                        />
                      </td>
                    )}
                    {(isDC || isTransport) && !historical && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedOpsIds.has(s.id)}
                          onChange={() => toggleSelectOps(s.id)}
                          className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        {isOverdue && <AlertTriangle size={14} className="text-red-500" />}
                        {!isOverdue && isUrgent && <Clock size={14} className="text-amber-500" />}
                        <span className="text-xs font-bold text-gray-400 dark:text-gray-500">#{offset + idx + 1}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                      {s.bl_number}
                      <CopyButton text={s.bl_number} title="Copy BL number" className="ml-1.5" />
                    </td>
                    <td className={colCls('invoice', 'hidden md:table-cell px-3 py-3 text-gray-500 dark:text-gray-400')}>{s.invoice_number}</td>
                    <td className={colCls('consignee', 'hidden lg:table-cell px-3 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-[160px]')}>
                      <span className="truncate block" title={s.consignee_name ?? undefined}>{s.consignee_name ?? <span className="text-gray-400 dark:text-gray-500 italic text-xs">—</span>}</span>
                    </td>
                    {showCompanyCol && (
                      <td className={colCls('company', 'hidden lg:table-cell px-3 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-[140px]')}>
                        <span className="truncate block" title={s.company_name ?? undefined}>{s.company_name ?? <span className="text-gray-400 dark:text-gray-500 italic text-xs">—</span>}</span>
                      </td>
                    )}
                    <td className={colCls('port', 'hidden xl:table-cell px-3 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap')}>
                      {s.loading_port_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className={colCls('offloading_location', 'hidden xl:table-cell px-3 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap')}>
                      {s.offloading_point_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className={colCls('bayan_type', 'hidden xl:table-cell px-3 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap')}>
                      {s.bayan_type_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className={colCls('shipping_line', 'hidden xl:table-cell px-3 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap')}>
                      {s.shipping_line_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className={colCls('stage', 'px-3 py-3')}>
                      {isPRO && s.current_stage === 'IN_PROGRESS' ? (() => {
                        const showPermit = !!(s.permit_status && s.permit_status !== 'COMPLETED' && s.permit_assigned_to_id === currentUserId)
                        const showBayan  = !!(s.bayan_status  && s.bayan_status  !== 'COMPLETED' && s.bayan_assigned_to_id  === currentUserId)
                        return (
                        <div className="flex flex-col gap-1">
                          {showPermit && (
                            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1',
                              s.permit_status === 'ON_HOLD'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                            )}>
                              {s.permit_status === 'ON_HOLD' && <AlertTriangle size={10} />}
                              Permit
                            </span>
                          )}
                          {showBayan && (
                            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1',
                              s.bayan_status === 'ON_HOLD'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                                : 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'
                            )}>
                              {s.bayan_status === 'ON_HOLD' && <AlertTriangle size={10} />}
                              Bayan
                            </span>
                          )}
                          {!showPermit && !showBayan && (
                            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STAGE_COLORS[s.current_stage])}>
                              {STAGE_LABELS[s.current_stage as ShipmentStage]}
                            </span>
                          )}
                        </div>
                        )
                      })() : isFFD && (s.do_revalidation_count > 0 || s.ccro_returned_count > 0) ? (
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
                      ) : isDC && (s.dc_health_cert_missing || s.dn_missing) ? (
                        <div className="flex flex-col gap-1">
                          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STAGE_COLORS[s.current_stage])}>
                            {STAGE_LABELS[s.current_stage as ShipmentStage]}
                          </span>
                          {s.dc_health_cert_missing && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                              <AlertTriangle size={10} /> Health Cert Missing
                            </span>
                          )}
                          {s.dn_missing && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                              <AlertTriangle size={10} /> DN Missing
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STAGE_COLORS[s.current_stage])}>
                          {STAGE_LABELS[s.current_stage as ShipmentStage]}
                        </span>
                      )}
                      {!historical && s.stage_since && (() => {
                        const days = Math.max(0, differenceInCalendarDays(new Date(), parseISO(s.stage_since)))
                        if (days < 1) return null
                        return (
                          <span
                            className={clsx(
                              'mt-1 flex items-center gap-1 text-[10px] font-medium whitespace-nowrap',
                              days >= 7 ? 'text-red-500 dark:text-red-400' :
                              days >= 3 ? 'text-amber-500 dark:text-amber-400' :
                              'text-gray-400 dark:text-gray-500'
                            )}
                            title={`In ${STAGE_LABELS[s.current_stage as ShipmentStage]} for ${days} day${days !== 1 ? 's' : ''}`}
                          >
                            <Clock size={9} /> {days}d in stage
                          </span>
                        )
                      })()}
                    </td>
                    <td className={colCls('progress', 'px-3 py-3')}>
                      <ProgressCell s={s} />
                    </td>
                    <td className={colCls('pull_out', 'hidden md:table-cell px-3 py-3 text-gray-600 dark:text-gray-300')}>
                      {historical ? (
                        <span className="text-xs text-gray-600 dark:text-gray-300">{formatDateTime(s.offloading_date)}</span>
                      ) : isCustomer && editingDateId === s.id ? (
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
                    <td className={colCls('eta', 'hidden xl:table-cell px-3 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap')}>
                      {formatDate(s.eta_at_port)}
                    </td>
                    <td className={colCls('do_validity', 'hidden xl:table-cell px-3 py-3 whitespace-nowrap')}>
                      {s.do_validity_date ? (
                        <span className={clsx('text-xs', doValidityStyle(s.do_validity_date).color)}>
                          {formatDate(s.do_validity_date)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className={colCls('amls', 'hidden lg:table-cell px-3 py-3')}>
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
                      ) : isFFD ? (
                        <button
                          onClick={() => { setEditingAmlsId(s.id); setAmlsValue(s.amls_job_number ?? '') }}
                          className="flex items-center gap-1 text-left border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 rounded px-1.5 py-0.5 transition-colors group/amls"
                          title="Edit AMLS Job#"
                        >
                          <span className="text-xs text-gray-600 dark:text-gray-300">
                            {s.amls_job_number || <span className="text-gray-400 italic">—</span>}
                          </span>
                          <Pencil size={10} className="text-gray-400 group-hover/amls:text-blue-500 shrink-0 transition-colors" />
                        </button>
                      ) : (
                        <span className="text-xs text-gray-600 dark:text-gray-300">
                          {s.amls_job_number || <span className="text-gray-400">—</span>}
                        </span>
                      )}
                    </td>
                    <td className={colCls('permit_no', 'hidden lg:table-cell px-3 py-3')}>
                      {s.permit_not_required ? (
                        <span
                          className="text-xs italic font-medium text-amber-600 dark:text-amber-400"
                          title="Permit not required for this shipment"
                        >
                          Not required
                        </span>
                      ) : pendingPermitNaIds.has(s.id) ? (
                        <span className="text-xs italic text-gray-400 dark:text-gray-500">Marking not required…</span>
                      ) : isPRO && s.permit_assigned_to_id === currentUserId ? (
                        editingPermitId === s.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={permitRefValue}
                              onChange={e => setPermitRefValue(e.target.value)}
                              autoFocus
                              placeholder="Permit No…"
                              onKeyDown={e => {
                                if (e.key === 'Enter') savePermitRef(s.id)
                                if (e.key === 'Escape') setEditingPermitId(null)
                              }}
                              className="text-xs border dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-24"
                            />
                            <button
                              onClick={() => savePermitRef(s.id)}
                              disabled={savingPermitId === s.id}
                              className="p-1 text-green-600 hover:text-green-700 disabled:opacity-40"
                              title="Save"
                            >
                              <CheckCircle size={14} />
                            </button>
                            <button
                              onClick={() => setEditingPermitId(null)}
                              disabled={savingPermitId === s.id}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-40"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => { setEditingPermitId(s.id); setPermitRefValue(s.permit_ref ?? '') }}
                              className="flex items-center gap-1 text-left border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 rounded px-1.5 py-0.5 transition-colors group/permit"
                              title="Edit Permit No"
                            >
                              <span className="text-xs text-gray-600 dark:text-gray-300">
                                {s.permit_ref || <span className="text-gray-400 italic">—</span>}
                              </span>
                              <Pencil size={10} className="text-gray-400 group-hover/permit:text-blue-500 shrink-0 transition-colors" />
                            </button>
                            {s.permit_status === 'IN_PROGRESS' && s.permit_task_id && (
                              confirmPermitNaId === s.id ? (
                                <span className="flex items-center gap-0.5">
                                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">Not required?</span>
                                  <button
                                    onClick={() => schedulePermitNotRequired(s)}
                                    className="p-1 text-green-600 hover:text-green-700"
                                    title="Confirm — mark permit not required and complete the Permit task"
                                  >
                                    <CheckCircle size={14} />
                                  </button>
                                  <button
                                    onClick={() => setConfirmPermitNaId(null)}
                                    className="p-1 text-gray-400 hover:text-gray-600"
                                    title="Cancel"
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              ) : confirmPermitCompleteId === s.id ? (
                                <span className="flex items-center gap-0.5">
                                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400 whitespace-nowrap">Complete task?</span>
                                  <button
                                    onClick={() => completePermitTask(s)}
                                    disabled={savingPermitCompleteId === s.id}
                                    className="p-1 text-green-600 hover:text-green-700 disabled:opacity-40"
                                    title="Confirm — complete the Permit task"
                                  >
                                    <CheckCircle size={14} />
                                  </button>
                                  <button
                                    onClick={() => setConfirmPermitCompleteId(null)}
                                    disabled={savingPermitCompleteId === s.id}
                                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-40"
                                    title="Cancel"
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setConfirmPermitNaId(s.id)}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-400 dark:hover:border-amber-500 transition-colors whitespace-nowrap"
                                    title="Mark permit as not required and complete the Permit task"
                                  >
                                    Permit Not Required
                                  </button>
                                  <button
                                    onClick={() => setConfirmPermitCompleteId(s.id)}
                                    disabled={!s.permit_ref}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-dashed transition-colors whitespace-nowrap border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:border-green-400 dark:hover:border-green-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:border-gray-300 dark:disabled:hover:border-gray-600"
                                    title={s.permit_ref ? 'Complete the Permit task (permit number is filled)' : 'Enter the Permit No first to complete the task'}
                                  >
                                    Complete
                                  </button>
                                </>
                              )
                            )}
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-gray-600 dark:text-gray-300">
                          {s.permit_ref || <span className="text-gray-400">—</span>}
                        </span>
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
                        <button
                          onClick={() => handleDownloadAll(s.id, s.bl_number)}
                          disabled={downloadingIds.has(s.id)}
                          title="Download all documents"
                          className="text-gray-400 hover:text-blue-600 disabled:opacity-40 transition-colors"
                        >
                          {downloadingIds.has(s.id)
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Download size={14} />}
                        </button>
                        {showHoldBtn && (
                          <button
                            onClick={() => {
                              const willOpen = holdPanelId !== s.id
                              setHoldPanelId(willOpen ? s.id : null)
                              if (willOpen) onExpand?.(null)
                            }}
                            title={hasActiveHold ? 'Active hold — click to manage' : 'Put task on hold'}
                            className={clsx(
                              'w-5 h-5 rounded flex items-center justify-center transition-colors shrink-0',
                              holdPanelId === s.id
                                ? 'bg-red-700 text-white'
                                : hasActiveHold
                                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                : 'bg-red-600 hover:bg-red-700 text-white'
                            )}
                          >
                            <Pause size={10} />
                          </button>
                        )}
                        <Link to={`/shipments/${s.id}`} className="text-blue-600 hover:underline text-xs whitespace-nowrap">
                          View →
                        </Link>
                      </div>
                    </td>
                    {isFFD && (
                      <td className="px-3 py-3">
                        {showReviewBtn && (
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => handleApproveDocs(s.id)}
                              disabled={approvingIds.has(s.id)}
                              className="flex items-center gap-1 text-xs bg-green-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium whitespace-nowrap"
                            >
                              {approvingIds.has(s.id) ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                              Approve
                            </button>
                            <button
                              onClick={() => { if (!isExpanded) setHoldPanelId(null); onExpand?.(isExpanded ? null : s.id) }}
                            className={clsx(
                                'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors whitespace-nowrap',
                                isExpanded
                                  ? 'bg-red-600 text-white border-red-600'
                                  : 'border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                              )}
                            >
                              Send Back
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          </div>
                        )}
                        {showAssignBtn && (
                          <button
                            onClick={() => { if (!isExpanded) setHoldPanelId(null); onExpand?.(isExpanded ? null : s.id) }}
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
                  {isExpanded && showReviewBtn && (
                    <tr key={`${s.id}-sendback`}>
                      <td colSpan={colSpan} className="p-0">
                        <InlineSendBackPanel
                          shipmentId={s.id}
                          blNumber={s.bl_number}
                          onDone={() => onExpand?.(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {isExpanded && showAssignBtn && proUsers && (
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
                  {holdPanelId === s.id && showHoldBtn && (
                    <tr key={`${s.id}-hold`}>
                      <td colSpan={colSpan} className="p-0">
                        <InlineHoldPanel
                          shipmentId={s.id}
                          userTeam={isFFD ? 'FFD' : 'PRO'}
                          onDone={() => setHoldPanelId(null)}
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

      {isCustomer && !historical && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          countClass="text-blue-400"
          onClear={() => { setSelectedIds(new Set()); setBulkDate('') }}
        >
          <input
            type="date"
            value={bulkDate}
            onChange={e => setBulkDate(e.target.value)}
            className="text-xs border border-gray-600 rounded px-2 py-1.5 bg-gray-800 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 shrink-0"
          />
          <button
            onClick={saveBulkDate}
            disabled={!bulkDate || savingBulk}
            className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
          >
            <CheckCircle size={13} />
            {savingBulk ? 'Saving…' : 'Set Pull-out Date'}
          </button>
          <button
            onClick={() => { setBulkDownloadIds(Array.from(selectedIds)); setShowBulkDownload(true) }}
            className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
          >
            <FileDown size={13} /> Download Docs
          </button>
        </BulkActionBar>
      )}

      {isPRO && !historical && selectedProIds.size > 0 && (
        <BulkActionBar
          count={selectedProIds.size}
          countClass="text-blue-400"
          onClear={() => setSelectedProIds(new Set())}
        >
          {/* Bayan payment request hidden — payment is now auto-requested on Bayan task completion */}
          {(() => {
            const TASK_BLOCKED_STAGES = ['FFD_REVIEW', 'TRANSPORT', 'DC_TRANSPORT']
            const stageBlocked = displaySorted.some(s => selectedProIds.has(s.id) && TASK_BLOCKED_STAGES.includes(s.current_stage))
            const stageTitle = stageBlocked ? 'One or more selected shipments are in a stage where task actions are not applicable' : undefined
            return (
              <>
                {stageBlocked && (
                  <button
                    onClick={() => setSelectedProIds(prev => new Set([...prev].filter(id => !TASK_BLOCKED_STAGES.includes(displaySorted.find(s => s.id === id)?.current_stage ?? ''))))}
                    className="text-xs text-amber-300 hover:text-amber-100 underline underline-offset-2 shrink-0 whitespace-nowrap"
                  >
                    Deselect ineligible
                  </button>
                )}
                <button
                  onClick={() => setShowBulkHoldPRO(true)}
                  disabled={stageBlocked}
                  title={stageTitle}
                  className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
                >
                  <Pause size={13} /> Put on Hold
                </button>
                <button
                  onClick={() => setShowBulkReleaseHoldPRO(true)}
                  disabled={stageBlocked}
                  title={stageTitle}
                  className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
                >
                  <Unlock size={13} /> Release Hold
                </button>
              </>
            )
          })()}
          <button
            onClick={() => { setBulkDownloadIds(Array.from(selectedProIds)); setShowBulkDownload(true) }}
            className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
          >
            <FileDown size={13} /> Download Docs
          </button>
        </BulkActionBar>
      )}

      {isFFD && !historical && selectedFFDIds.size > 0 && (
        <BulkActionBar
          count={selectedFFDIds.size}
          countClass="text-purple-400"
          onClear={() => setSelectedFFDIds(new Set())}
        >
            {(() => {
              const TASK_BLOCKED_STAGES = ['FFD_REVIEW', 'TRANSPORT', 'DC_TRANSPORT']
              const selectedShips = displaySorted.filter(s => selectedFFDIds.has(s.id))
              const stageBlocked = selectedShips.some(s => TASK_BLOCKED_STAGES.includes(s.current_stage))
              const stageTitle = stageBlocked ? 'One or more selected shipments are in a stage where task actions are not applicable' : undefined
              const bayanBlocked = stageBlocked || selectedShips.some(s => s.bayan_status !== null)
              const assignBayanBlocked = stageBlocked || selectedShips.some(s => s.bayan_status === null || s.bayan_status === 'COMPLETED')
              const assignPermitBlocked = stageBlocked || selectedShips.some(s => s.permit_status === 'COMPLETED')
              return (
                <>
                  {stageBlocked && (
                    <button
                      onClick={() => setSelectedFFDIds(prev => new Set([...prev].filter(id => !TASK_BLOCKED_STAGES.includes(displaySorted.find(s => s.id === id)?.current_stage ?? ''))))}
                      className="text-xs text-amber-300 hover:text-amber-100 underline underline-offset-2 shrink-0 whitespace-nowrap"
                    >
                      Deselect ineligible
                    </button>
                  )}
                  <button
                    onClick={handleBulkOpenBayan}
                    disabled={savingBulkOpenBayan || bayanBlocked}
                    title={stageBlocked ? stageTitle : bayanBlocked ? 'One or more selected shipments already have a Bayan task open or completed' : undefined}
                    className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
                  >
                    <ListTodo size={13} />
                    {savingBulkOpenBayan ? 'Opening…' : 'Open Bayan'}
                  </button>
                  <button
                    onClick={() => setShowBulkAssignBayan(true)}
                    disabled={assignBayanBlocked}
                    title={stageBlocked ? stageTitle : assignBayanBlocked ? 'All selected shipments must have an open (non-completed) Bayan task' : undefined}
                    className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
                  >
                    <UserCheck size={13} /> Assign Bayan →
                  </button>
                  <button
                    onClick={() => setShowBulkAssignPermit(true)}
                    disabled={assignPermitBlocked}
                    title={stageBlocked ? stageTitle : assignPermitBlocked ? 'One or more selected shipments have a completed Permit task — cannot reassign' : undefined}
                    className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
                  >
                    <UserCheck size={13} /> Assign Permit →
                  </button>
                  <button
                    onClick={() => setShowBulkHoldFFD(true)}
                    disabled={stageBlocked}
                    title={stageTitle}
                    className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
                  >
                    <Pause size={13} /> Put on Hold
                  </button>
                  <button
                    onClick={() => setShowBulkReleaseHoldFFD(true)}
                    disabled={stageBlocked}
                    title={stageTitle}
                    className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
                  >
                    <Unlock size={13} /> Release Hold
                  </button>
                </>
              )
            })()}
            <button
              onClick={() => { setBulkDownloadIds(Array.from(selectedFFDIds)); setShowBulkDownload(true) }}
              className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
            >
              <FileDown size={13} /> Download Docs
            </button>
        </BulkActionBar>
      )}

      {showBulkAssignBayan && proUsers && (
        <BulkAssignTaskModal
          taskType="BAYAN"
          selectedIds={Array.from(selectedFFDIds)}
          proUsers={proUsers}
          onClose={() => setShowBulkAssignBayan(false)}
          onDone={() => { setShowBulkAssignBayan(false); setSelectedFFDIds(new Set()) }}
        />
      )}
      {showBulkAssignPermit && proUsers && (
        <BulkAssignTaskModal
          taskType="PERMIT"
          selectedIds={Array.from(selectedFFDIds)}
          proUsers={proUsers}
          onClose={() => setShowBulkAssignPermit(false)}
          onDone={() => { setShowBulkAssignPermit(false); setSelectedFFDIds(new Set()) }}
        />
      )}
      {showBulkHoldFFD && (
        <BulkHoldModal
          selectedIds={Array.from(selectedFFDIds)}
          selectedShipments={displaySorted.filter(s => selectedFFDIds.has(s.id))}
          userTeam="FFD"
          onClose={() => setShowBulkHoldFFD(false)}
          onDone={() => { setShowBulkHoldFFD(false); setSelectedFFDIds(new Set()) }}
        />
      )}
      {showBulkReleaseHoldFFD && (
        <BulkReleaseHoldModal
          selectedIds={Array.from(selectedFFDIds)}
          selectedShipments={displaySorted.filter(s => selectedFFDIds.has(s.id))}
          userTeam="FFD"
          onClose={() => setShowBulkReleaseHoldFFD(false)}
          onDone={() => { setShowBulkReleaseHoldFFD(false); setSelectedFFDIds(new Set()) }}
        />
      )}
      {showBulkHoldPRO && (
        <BulkHoldModal
          selectedIds={Array.from(selectedProIds)}
          selectedShipments={displaySorted.filter(s => selectedProIds.has(s.id))}
          userTeam="PRO"
          currentUserId={currentUserId}
          onClose={() => setShowBulkHoldPRO(false)}
          onDone={() => { setShowBulkHoldPRO(false); setSelectedProIds(new Set()) }}
        />
      )}
      {showBulkReleaseHoldPRO && (
        <BulkReleaseHoldModal
          selectedIds={Array.from(selectedProIds)}
          selectedShipments={displaySorted.filter(s => selectedProIds.has(s.id))}
          userTeam="PRO"
          currentUserId={currentUserId}
          onClose={() => setShowBulkReleaseHoldPRO(false)}
          onDone={() => { setShowBulkReleaseHoldPRO(false); setSelectedProIds(new Set()) }}
        />
      )}

      {/* Admin bulk delete floating bar */}
      {isAdmin && !historical && selectedAdminIds.size > 0 && (
        <BulkActionBar
          count={selectedAdminIds.size}
          countClass="text-red-400"
          onClear={() => setSelectedAdminIds(new Set())}
        >
          <button
            onClick={() => setConfirmBulkDelete(true)}
            className="flex items-center gap-1.5 text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
          >
            <X size={13} /> Delete Selected
          </button>
          <button
            onClick={() => { setBulkDownloadIds(Array.from(selectedAdminIds)); setShowBulkDownload(true) }}
            className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
          >
            <FileDown size={13} /> Download Docs
          </button>
        </BulkActionBar>
      )}

      {/* Transport/DC bulk download floating bar */}
      {(isTransport || isDC) && !historical && selectedOpsIds.size > 0 && (
        <BulkActionBar
          count={selectedOpsIds.size}
          countClass="text-teal-400"
          onClear={() => setSelectedOpsIds(new Set())}
        >
          <button
            onClick={() => { setBulkDownloadIds(Array.from(selectedOpsIds)); setShowBulkDownload(true) }}
            className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg font-medium shrink-0 whitespace-nowrap"
          >
            <FileDown size={13} /> Download Docs
          </button>
        </BulkActionBar>
      )}

      {showBulkDownload && (
        <BulkDownloadModal
          selectedIds={bulkDownloadIds}
          onClose={() => setShowBulkDownload(false)}
        />
      )}

      {/* Admin bulk delete confirmation dialog */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Confirm Bulk Delete</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                You are about to permanently delete{' '}
                <span className="font-semibold text-red-600">{selectedAdminIds.size}</span>{' '}
                shipment{selectedAdminIds.size !== 1 ? 's' : ''}. This cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t dark:border-gray-700">
              <button
                onClick={() => setConfirmBulkDelete(false)}
                disabled={savingBulkDelete}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={savingBulkDelete}
                className="text-xs bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {savingBulkDelete ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  // Internal users can see and filter by customer company; customer users are scoped server-side
  const showCompanyCol = !!user && !isCustomerTeam(user)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const view = (searchParams.get('view') as 'priority' | 'containers') ?? (isTransport || isDC ? 'containers' : 'priority')
  const setView = (v: 'priority' | 'containers') => setSearchParams(p => { p.set('view', v); return p })
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const setPage = (p: number) => setSearchParams(params => { params.set('page', String(p)); return params })
  const defaultStage: ShipmentStage | '' | 'my_queue' = (user?.team === 'MANAGEMENT' || user?.is_admin) ? '' : 'my_queue'
  const stageFilter = (searchParams.get('stage') as ShipmentStage | '' | 'my_queue' | null) ?? defaultStage
  const setStageFilter = (s: ShipmentStage | '' | 'my_queue') => setSearchParams(p => { p.set('stage', s); return p })
  const historical = searchParams.get('historical') === 'true'
  const setHistorical = (v: boolean) => setSearchParams(p => { p.set('historical', String(v)); p.set('page', '1'); if (v) p.delete('stage'); return p })
  // Company (customer) filter — URL-driven so the dashboard can link to /shipments?company_id=…
  const filterCompany = searchParams.get('company_id') ?? ''
  const setFilterCompany = (v: string) => setSearchParams(p => { if (v) p.set('company_id', v); else p.delete('company_id'); p.set('page', '1'); return p })
  // Personal customer focus (internal users): defaults the list to the user's own
  // customers. Explicit company filter and "Show all" both override it.
  const focusIds = (user && !isCustomerTeam(user) && user.focus_company_ids) || []
  const [showAllCustomers, setShowAllCustomers] = useState(false)
  const customerFocusActive = focusIds.length > 0 && !showAllCustomers && !filterCompany
  const focusCompanyIdsParam = customerFocusActive ? focusIds.join(',') : undefined
  const [missingDate, setMissingDate] = useState(false)
  const [amlsSearch, setAmlsSearch] = useState('')
  const [debouncedAmlsSearch, setDebouncedAmlsSearch] = useState('')
  const [missingAmls, setMissingAmls] = useState(false)
  const [pullOutFrom, setPullOutFrom] = useState('')
  const [pullOutTo, setPullOutTo] = useState('')
  const [completedFrom, setCompletedFrom] = useState('')
  const [completedTo, setCompletedTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showBulkBayan, setShowBulkBayan] = useState(false)
  const [showBulkPermit, setShowBulkPermit] = useState(false)
  const [showBulkDO, setShowBulkDO] = useState(false)
  const [showBulkDORenewal, setShowBulkDORenewal] = useState(false)
  const [showBulkMisc, setShowBulkMisc] = useState(false)
  // Initialized from the URL so the dashboard "needs attention" chips can link here
  const [filterDoExpired, setFilterDoExpired] = useState(() =>
    searchParams.get('do_expired') === 'true' || searchParams.get('do_expiring') === 'true')
  const [filterDoExpiringSoon, setFilterDoExpiringSoon] = useState(() => searchParams.get('do_expiring') === 'true')
  const [showBulkCcro, setShowBulkCcro] = useState(false)
  const [showBulkSalalah, setShowBulkSalalah] = useState(false)
  const [sort, setSort] = useState<SortState>({ column: null, dir: 'asc' })
  const toggleSort = useCallback((column: string) => {
    setSort(s => ({ column, dir: s.column === column && s.dir === 'asc' ? 'desc' : 'asc' }))
    setPage(1)
  }, [])

  // Column-level filter state (new — server-driven)
  const [filterConsignee, setFilterConsignee] = useState('')
  const [debouncedConsignee, setDebouncedConsignee] = useState('')
  const [filterPort, setFilterPort] = useState('')
  const [debouncedPort, setDebouncedPort] = useState('')
  const [filterOffloading, setFilterOffloading] = useState('')
  const [debouncedOffloading, setDebouncedOffloading] = useState('')
  const [filterBayanType, setFilterBayanType] = useState('')
  const [debouncedBayanType, setDebouncedBayanType] = useState('')
  const [filterShippingLine, setFilterShippingLine] = useState('')
  const [debouncedShippingLine, setDebouncedShippingLine] = useState('')
  const [filterEtaFrom, setFilterEtaFrom] = useState('')
  const [filterEtaTo, setFilterEtaTo] = useState('')
  const [filterDoValidityFrom, setFilterDoValidityFrom] = useState('')
  const [filterDoValidityTo, setFilterDoValidityTo] = useState('')
  const [filterPermit, setFilterPermit] = useState('')
  const [debouncedPermit, setDebouncedPermit] = useState('')

  const [isMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? new Set(MOBILE_DEFAULT_HIDDEN) : new Set()
  )
  const [showColPicker, setShowColPicker] = useState(false)
  const colPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user?.id) return
    try {
      const key = isMobile ? `col_prefs_mobile_${user.id}` : `col_prefs_${user.id}`
      const stored = localStorage.getItem(key)
      if (stored) setHiddenCols(new Set(JSON.parse(stored) as string[]))
      else if (isMobile) setHiddenCols(new Set(MOBILE_DEFAULT_HIDDEN))
    } catch { /* ignore */ }
  }, [user?.id, isMobile])

  useEffect(() => {
    if (!showColPicker) return
    function handleOutside(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showColPicker])

  function toggleCol(key: string) {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      const storageKey = isMobile ? `col_prefs_mobile_${user!.id}` : `col_prefs_${user!.id}`
      try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  // On mobile: badge counts extra-visible columns (added beyond default). On desktop: hidden count.
  const colBadgeCount = isMobile
    ? [...MOBILE_DEFAULT_HIDDEN].filter(k => !hiddenCols.has(k)).length
    : hiddenCols.size
  // Customized if state differs from the breakpoint default
  const hasCustomCols = isMobile
    ? hiddenCols.size !== MOBILE_DEFAULT_HIDDEN.size || [...hiddenCols].some(k => !MOBILE_DEFAULT_HIDDEN.has(k))
    : hiddenCols.size > 0

  function colCls(key: string, whenVisible: string): string {
    return hiddenCols.has(key) ? 'hidden' : whenVisible
  }

  // PRO users list — only needed for FFD inline assignment

  const { data: proUsers = [] } = useQuery({
    queryKey: ['team-members', 'PRO'],
    queryFn: () => authApi.listTeamMembers('PRO').then(r => r.data),
    enabled: isFFD,
  })

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list().then(r => r.data),
    enabled: showCompanyCol,
  })
  const companyOptions = companies.map(c => ({ value: c.id, label: c.name }))

  async function handleBlExport() {
    try {
      const { data } = await shipmentsApi.blExport({
        search: debouncedSearch || undefined,
        stage: (!historical && !isMyQueue) ? (stageFilter || undefined) : undefined,
        company_id: filterCompany || undefined,
        company_ids: focusCompanyIdsParam,
        my_queue: isMyQueue || undefined,
        missing_date: (!historical && missingDate) || undefined,
        amls_search: debouncedAmlsSearch || undefined,
        missing_amls: missingAmls || undefined,
        pull_out_from: (!historical && pullOutFrom) || undefined,
        pull_out_to: (!historical && pullOutTo) || undefined,
        historical: historical || undefined,
        completed_from: (historical && completedFrom) || undefined,
        completed_to: (historical && completedTo) || undefined,
        do_expired: (filterDoExpired && !filterDoExpiringSoon) || undefined,
        do_validity_from: filterDoExpiringSoon ? new Date().toISOString().slice(0, 10) : undefined,
        do_validity_to: filterDoExpiringSoon ? (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10) })() : undefined,
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

  useEffect(() => { const t = setTimeout(() => setDebouncedConsignee(filterConsignee), 300); return () => clearTimeout(t) }, [filterConsignee])
  useEffect(() => { const t = setTimeout(() => setDebouncedPort(filterPort), 300); return () => clearTimeout(t) }, [filterPort])
  useEffect(() => { const t = setTimeout(() => setDebouncedOffloading(filterOffloading), 300); return () => clearTimeout(t) }, [filterOffloading])
  useEffect(() => { const t = setTimeout(() => setDebouncedBayanType(filterBayanType), 300); return () => clearTimeout(t) }, [filterBayanType])
  useEffect(() => { const t = setTimeout(() => setDebouncedShippingLine(filterShippingLine), 300); return () => clearTimeout(t) }, [filterShippingLine])
  useEffect(() => { const t = setTimeout(() => setDebouncedPermit(filterPermit), 300); return () => clearTimeout(t) }, [filterPermit])

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setPage(1)
  }, [debouncedSearch, stageFilter, missingDate, debouncedAmlsSearch, missingAmls, pullOutFrom, pullOutTo, completedFrom, completedTo, debouncedConsignee, debouncedPort, debouncedOffloading, debouncedBayanType, debouncedShippingLine, filterEtaFrom, filterEtaTo, filterDoValidityFrom, filterDoValidityTo, debouncedPermit])

  const skip = (page - 1) * PAGE_SIZE
  const isMyQueue = !historical && stageFilter === 'my_queue'

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', skip, debouncedSearch, stageFilter, filterCompany, focusCompanyIdsParam, missingDate, debouncedAmlsSearch, missingAmls, pullOutFrom, pullOutTo, sort.column, sort.dir, historical, completedFrom, completedTo, debouncedConsignee, debouncedPort, debouncedOffloading, debouncedBayanType, debouncedShippingLine, filterEtaFrom, filterEtaTo, filterDoValidityFrom, filterDoValidityTo, debouncedPermit, filterDoExpired, filterDoExpiringSoon],
    queryFn: () => shipmentsApi.list({
      skip,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      stage: (!historical && !isMyQueue) ? (stageFilter || undefined) : undefined,
      company_id: filterCompany || undefined,
      company_ids: focusCompanyIdsParam,
      my_queue: isMyQueue || undefined,
      missing_date: (!historical && missingDate) || undefined,
      amls_search: debouncedAmlsSearch || undefined,
      missing_amls: missingAmls || undefined,
      pull_out_from: (!historical && pullOutFrom) || undefined,
      pull_out_to: (!historical && pullOutTo) || undefined,
      sort_by: sort.column || undefined,
      sort_dir: sort.column ? sort.dir : undefined,
      historical: historical || undefined,
      completed_from: (historical && completedFrom) || undefined,
      completed_to: (historical && completedTo) || undefined,
      consignee_search: debouncedConsignee || undefined,
      port_search: debouncedPort || undefined,
      offloading_search: debouncedOffloading || undefined,
      bayan_type_search: debouncedBayanType || undefined,
      shipping_line_search: debouncedShippingLine || undefined,
      eta_from: filterEtaFrom || undefined,
      eta_to: filterEtaTo || undefined,
      do_validity_from: filterDoExpiringSoon ? new Date().toISOString().slice(0, 10) : (filterDoValidityFrom || undefined),
      do_validity_to: filterDoExpiringSoon ? (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10) })() : (filterDoValidityTo || undefined),
      permit_search: debouncedPermit || undefined,
      do_expired: (filterDoExpired && !filterDoExpiringSoon) || undefined,
    }).then(r => r.data),
    placeholderData: prev => prev,
  })

  const items      = data?.items ?? []
  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const colFilters: ColFilters = {
    bl: search,
    consignee: filterConsignee,
    company: filterCompany,
    port: filterPort,
    offloading: filterOffloading,
    bayan_type: filterBayanType,
    shipping_line: filterShippingLine,
    stage: stageFilter === 'my_queue' ? '' : stageFilter,
    pull_out_from: pullOutFrom,
    pull_out_to: pullOutTo,
    eta_from: filterEtaFrom,
    eta_to: filterEtaTo,
    do_validity_from: filterDoValidityFrom,
    do_validity_to: filterDoValidityTo,
    amls: amlsSearch,
    permit: filterPermit,
  }

  function handleColFilter(key: keyof ColFilters, value: string) {
    switch (key) {
      case 'bl': setSearch(value); break
      case 'consignee': setFilterConsignee(value); break
      case 'company': setFilterCompany(value); break
      case 'port': setFilterPort(value); break
      case 'offloading': setFilterOffloading(value); break
      case 'bayan_type': setFilterBayanType(value); break
      case 'shipping_line': setFilterShippingLine(value); break
      case 'stage': setStageFilter(value as typeof stageFilter); break
      case 'pull_out_from': setPullOutFrom(value); break
      case 'pull_out_to': setPullOutTo(value); break
      case 'eta_from': setFilterEtaFrom(value); break
      case 'eta_to': setFilterEtaTo(value); break
      case 'do_validity_from': setFilterDoValidityFrom(value); break
      case 'do_validity_to': setFilterDoValidityTo(value); break
      case 'amls': setAmlsSearch(value); break
      case 'permit': setFilterPermit(value); break
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-5 gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">All Shipments</h1>
        <div className="flex flex-col items-end gap-2">
          {/* Bulk document uploads */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isPRO && (
              <button
                onClick={() => setShowBulkPermit(true)}
                className="flex items-center gap-2 bg-green-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 whitespace-nowrap"
              >
                <Files size={16} /> <span className="hidden sm:inline">Bulk Upload Permits</span><span className="sm:hidden">Permits</span>
              </button>
            )}
            {isPRO && (
              <button
                onClick={() => setShowBulkBayan(true)}
                className="flex items-center gap-2 bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
              >
                <Files size={16} /> <span className="hidden sm:inline">Bulk Upload Bayans</span><span className="sm:hidden">Bayans</span>
              </button>
            )}
            {isFFD && (
              <>
                <button
                  onClick={() => setShowBulkDO(true)}
                  className="flex items-center gap-2 bg-purple-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 whitespace-nowrap"
                >
                  <Files size={16} /> <span className="hidden sm:inline">Bulk Upload DOs</span><span className="sm:hidden">DOs</span>
                </button>
                <button
                  onClick={() => setShowBulkCcro(true)}
                  className="flex items-center gap-2 bg-teal-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 whitespace-nowrap"
                >
                  <Files size={16} /> <span className="hidden sm:inline">Bulk Upload CCROs</span><span className="sm:hidden">CCROs</span>
                </button>
              </>
            )}
            {(isPRO || isFFD) && (
              <button
                onClick={() => setShowBulkMisc(true)}
                className="flex items-center gap-2 bg-gray-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 whitespace-nowrap"
              >
                <Files size={16} /> <span className="hidden sm:inline">Bulk Upload Misc</span><span className="sm:hidden">Misc</span>
              </button>
            )}
            {user?.team === 'CUSTOMER' && (
              <Link to="/shipments/new" className="flex items-center gap-2 bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap">
                <Plus size={16} /> <span className="hidden sm:inline">New Shipment</span><span className="sm:hidden">New</span>
              </Link>
            )}
          </div>
          {/* Salalah flow — separate action, its own row */}
          {isFFD && (
            <button
              onClick={() => setShowBulkSalalah(true)}
              className="flex items-center gap-2 bg-orange-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 whitespace-nowrap"
            >
              <CheckCircle size={16} /> <span className="hidden sm:inline">Salalah Confirmation</span><span className="sm:hidden">Salalah</span>
            </button>
          )}
        </div>
      </div>

      {showBulkBayan && (
        <BulkBayanUploadModal
          onClose={() => setShowBulkBayan(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}
      {showBulkPermit && (
        <BulkPermitUploadModal
          onClose={() => setShowBulkPermit(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}
      {showBulkDO && (
        <BulkDOUploadModal
          onClose={() => setShowBulkDO(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}
      {showBulkDORenewal && (
        <BulkDOUploadModal
          onClose={() => setShowBulkDORenewal(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
          renewalMode
        />
      )}
      {showBulkCcro && (
        <BulkCcroUploadModal
          onClose={() => setShowBulkCcro(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}
      {showBulkSalalah && (
        <BulkSalalahConfirmModal
          onClose={() => setShowBulkSalalah(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}
      {showBulkMisc && (
        <BulkMiscUploadModal
          onClose={() => setShowBulkMisc(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}

      {/* Personal customer focus (internal users) — explicit company filter overrides it */}
      <CustomerFocusBar
        showingAll={showAllCustomers}
        onShowingAllChange={setShowAllCustomers}
        suppressed={!!filterCompany}
      />

      {/* Active / History toggle */}
      <div className="flex items-center gap-1 mb-3 border dark:border-gray-600 rounded-lg overflow-hidden w-fit">
        <button
          onClick={() => setHistorical(false)}
          className={clsx('px-4 py-1.5 text-sm font-medium transition-colors',
            !historical ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
        >
          Active
        </button>
        <button
          onClick={() => setHistorical(true)}
          className={clsx('px-4 py-1.5 text-sm font-medium transition-colors',
            historical ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
        >
          History
        </button>
      </div>

      {/* PRO: My Tasks / All quick-filter chips (active view only) */}
      {isPRO && !historical && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
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
          <button
            onClick={() => { setFilterDoExpired(v => !v); setFilterDoExpiringSoon(false) }}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              filterDoExpired
                ? 'bg-red-600 text-white border-red-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            )}
          >
            DO Expired
          </button>
          {filterDoExpired && (
            <button
              onClick={() => setFilterDoExpiringSoon(v => !v)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                filterDoExpiringSoon
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              )}
            >
              Expiring in 3 days
            </button>
          )}
          {filterDoExpired && (
            <button
              onClick={() => setShowBulkDORenewal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              ↻ Renew DOs
            </button>
          )}
        </div>
      )}

      {/* Controls — row 1: search + stage + view toggle */}
      <div className="flex flex-wrap gap-2 mb-2">
        {view !== 'containers' && (
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search BL or invoice…"
              className="w-full border dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Stage dropdown — only in active B/L table view */}
        {!isPRO && !historical && view !== 'containers' && (
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value as ShipmentStage | '' | 'my_queue')}
            className="border dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {(user?.team !== 'MANAGEMENT' && !user?.is_admin) && (
              <option value="my_queue">My Queue</option>
            )}
            <option value="">All stages</option>
            {Object.entries(STAGE_LABELS).filter(([val]) => val !== 'COMPLETED').map(([val, label]) => (
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
          {!historical && (
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
              No Pull Out Date
            </button>
          )}
          {!historical && isFFD && (
            <button
              onClick={() => { setFilterDoExpired(v => !v); setFilterDoExpiringSoon(false) }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap',
                filterDoExpired
                  ? 'bg-red-600 text-white border-red-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              DO Expired
            </button>
          )}
          {!historical && isFFD && filterDoExpired && (
            <button
              onClick={() => setFilterDoExpiringSoon(v => !v)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap',
                filterDoExpiringSoon
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              )}
            >
              Expiring in 3 days
            </button>
          )}
          {!historical && isFFD && filterDoExpired && (
            <button
              onClick={() => setShowBulkDORenewal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors whitespace-nowrap"
            >
              ↻ Renew DOs
            </button>
          )}

          {!historical && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span>Pull-out from</span>
              <input
                type="date"
                value={pullOutFrom}
                onChange={e => setPullOutFrom(e.target.value)}
                className="border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 dark:text-white text-xs"
              />
              <span>to</span>
              <input
                type="date"
                value={pullOutTo}
                onChange={e => setPullOutTo(e.target.value)}
                className="border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 dark:text-white text-xs"
              />
              {(pullOutFrom || pullOutTo) && (
                <button onClick={() => { setPullOutFrom(''); setPullOutTo('') }} className="text-gray-400 hover:text-red-500">
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          {historical && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span>Offloading from</span>
              <input
                type="date"
                value={completedFrom}
                onChange={e => setCompletedFrom(e.target.value)}
                className="border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 dark:text-white text-xs"
              />
              <span>to</span>
              <input
                type="date"
                value={completedTo}
                onChange={e => setCompletedTo(e.target.value)}
                className="border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 dark:text-white text-xs"
              />
              {(completedFrom || completedTo) && (
                <button onClick={() => { setCompletedFrom(''); setCompletedTo('') }} className="text-gray-400 hover:text-red-500">
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          <div className="relative flex-1 sm:flex-none">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={amlsSearch}
              onChange={e => setAmlsSearch(e.target.value)}
              placeholder="AMLS Job#…"
              className="w-full sm:w-36 border dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg pl-7 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            No Job#
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <div className="relative" ref={colPickerRef}>
              <button
                onClick={() => setShowColPicker(v => !v)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap',
                  showColPicker || hasCustomCols
                    ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/20 dark:border-blue-600 dark:text-blue-400'
                    : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                )}
              >
                <SlidersHorizontal size={14} />
                Columns
                {colBadgeCount > 0 && (
                  <span className="ml-0.5 bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-medium leading-none">
                    {colBadgeCount}
                  </span>
                )}
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-3 min-w-[190px]">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Visible columns</p>
                  {ALL_COLUMNS.filter(col => col.key !== 'company' || showCompanyCol).map(col => (
                    <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer hover:text-gray-900 dark:hover:text-white">
                      <input
                        type="checkbox"
                        checked={!hiddenCols.has(col.key)}
                        onChange={() => toggleCol(col.key)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{col.label}</span>
                    </label>
                  ))}
                  {hasCustomCols && (
                    <button
                      onClick={() => {
                        const defaults = isMobile ? new Set(MOBILE_DEFAULT_HIDDEN) : new Set<string>()
                        setHiddenCols(defaults)
                        const storageKey = isMobile ? `col_prefs_mobile_${user!.id}` : `col_prefs_${user!.id}`
                        try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
                      }}
                      className="mt-2 w-full text-xs text-center text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleBlExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet size={14} />
              Export to Excel
            </button>
          </div>
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
        <ContainerView team={user!.team} historical={historical} focusCompanyIds={focusCompanyIdsParam} />
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
          isTransport={isTransport}
          isAdmin={user?.is_admin}
          currentUserId={user?.id}
          expandedId={expandedId}
          onExpand={setExpandedId}
          proUsers={proUsers as { id: string; full_name: string }[]}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
          sort={sort}
          onSort={toggleSort}
          hiddenCols={hiddenCols}
          isMobile={isMobile}
          historical={historical}
          colFilters={colFilters}
          onColFilter={handleColFilter}
          showCompanyCol={showCompanyCol}
          companyOptions={companyOptions}
        />
      )}

    </div>
  )
}
