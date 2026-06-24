import { useState, useEffect, useRef, useCallback } from 'react'
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
import { BulkCcroUploadModal } from '@/components/BulkCcroUploadModal'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'
import {
  Plus, Search, AlertTriangle, Clock, Table2,
  ChevronLeft, ChevronRight, X, Calendar,
  ChevronDown, ChevronUp, UserCheck, ListTodo, Box,
  CheckCircle, DollarSign, Pencil, FileSpreadsheet, Files, Download, Loader2,
  SlidersHorizontal,
} from 'lucide-react'
import { STAGE_LABELS, TASK_TYPE_LABELS } from '@/types'
import type { ShipmentListItem, ShipmentStage, TaskType, TaskStatus } from '@/types'
import type { SortState } from '@/lib/sort'
import { formatDate, formatDateTime } from '@/lib/dates'
import { SortableHeader } from '@/components/SortableHeader'
import clsx from 'clsx'

const ALL_COLUMNS = [
  { key: 'invoice',    label: 'Invoice' },
  { key: 'consignee',  label: 'Consignee' },
  { key: 'port',       label: 'Port of Loading' },
  { key: 'bayan_type', label: 'Bayan Type' },
  { key: 'stage',      label: 'Stage' },
  { key: 'progress',   label: 'Progress' },
  { key: 'pull_out',   label: 'Planned Pull Out' },
  { key: 'eta',        label: 'ETA to Port' },
  { key: 'do_validity',label: 'DO Validity' },
  { key: 'amls',       label: 'AMLS Job# / Permit No' },
] as const

// Columns hidden on mobile by default (previously handled by Tailwind responsive classes)
const MOBILE_DEFAULT_HIDDEN = new Set(['invoice', 'consignee', 'port', 'bayan_type', 'pull_out', 'eta', 'do_validity', 'amls'])

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

// ── Priority table (with optional FFD inline assign) ─────────────────────────

function PriorityTable({ shipments, page, totalPages, total, onPage, isFFD, isCustomer, isPRO, isDC, expandedId, onExpand, proUsers, onRefresh, sort, onSort, hiddenCols = new Set(), isMobile = false, historical = false }: {
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
  sort: SortState
  onSort: (col: string) => void
  hiddenCols?: Set<string>
  isMobile?: boolean
  historical?: boolean
}) {
  const qc = useQueryClient()
  const offset = (page - 1) * PAGE_SIZE
  const colSpan = isFFD ? 13 : (isCustomer || isPRO) ? 14 : 13

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
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">#</th>
              <SortableHeader label="BL Number"    column="bl"       sort={sort} onSort={onSort} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Invoice"      column="invoice"  sort={sort} onSort={onSort} className={colCls('invoice', 'hidden md:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')} />
              <th className={colCls('consignee', 'hidden lg:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>Consignee</th>
              <th className={colCls('port', 'hidden xl:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>Port of Loading</th>
              <th className={colCls('bayan_type', 'hidden xl:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>Bayan Type</th>
              <SortableHeader label={isPRO ? 'My Task' : 'Stage'} column="stage" sort={sort} onSort={onSort} className={colCls('stage', 'px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')} />
              <th className={colCls('progress', 'text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>Progress</th>
              <SortableHeader label={historical ? 'Offloading Date' : 'Planned Pull out'} column="pull_out" sort={sort} onSort={onSort} className={colCls('pull_out', 'hidden md:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')} />
              <SortableHeader label="ETA to Port"  column="eta"         sort={sort} onSort={onSort} className={colCls('eta',         'hidden xl:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')} />
              <SortableHeader label="DO Validity"  column="do_validity" sort={sort} onSort={onSort} className={colCls('do_validity', 'hidden xl:table-cell px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide')} />
              <th className={colCls('amls', 'hidden lg:table-cell text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap')}>{isPRO ? 'Permit No' : 'AMLS Job#'}</th>
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
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        {isOverdue && <AlertTriangle size={14} className="text-red-500" />}
                        {!isOverdue && isUrgent && <Clock size={14} className="text-amber-500" />}
                        <span className="text-xs font-bold text-gray-400 dark:text-gray-500">#{offset + idx + 1}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-gray-900 dark:text-white">{s.bl_number}</td>
                    <td className={colCls('invoice', 'hidden md:table-cell px-3 py-3 text-gray-500 dark:text-gray-400')}>{s.invoice_number}</td>
                    <td className={colCls('consignee', 'hidden lg:table-cell px-3 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-[160px]')}>
                      <span className="truncate block" title={s.consignee_name ?? undefined}>{s.consignee_name ?? <span className="text-gray-400 dark:text-gray-500 italic text-xs">—</span>}</span>
                    </td>
                    <td className={colCls('port', 'hidden xl:table-cell px-3 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap')}>
                      {s.loading_port_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className={colCls('bayan_type', 'hidden xl:table-cell px-3 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap')}>
                      {s.bayan_type_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className={colCls('stage', 'px-3 py-3')}>
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
                      {isPRO ? (
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
                        )
                      ) : isFFD && editingAmlsId === s.id ? (
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
                              onClick={() => onExpand?.(isExpanded ? null : s.id)}
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
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-3 bg-gray-900 dark:bg-gray-700 text-white px-5 py-3 rounded-2xl shadow-xl border border-gray-700 dark:border-gray-600 pointer-events-auto">
            <span className="text-sm">
              <span className="font-semibold text-blue-400">{selectedIds.size}</span>
              {' '}shipment{selectedIds.size !== 1 ? 's' : ''} selected
            </span>
            <input
              type="date"
              value={bulkDate}
              onChange={e => setBulkDate(e.target.value)}
              className="text-xs border border-gray-600 rounded px-2 py-1.5 bg-gray-800 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={saveBulkDate}
              disabled={!bulkDate || savingBulk}
              className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-medium"
            >
              <CheckCircle size={13} />
              {savingBulk ? 'Saving…' : 'Set Pull-out Date'}
            </button>
            <button
              onClick={() => { setSelectedIds(new Set()); setBulkDate('') }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-800 dark:hover:bg-gray-600"
            >
              <X size={13} /> Clear
            </button>
          </div>
        </div>
      )}

      {isPRO && !historical && selectedProIds.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-3 bg-gray-900 dark:bg-gray-700 text-white px-5 py-3 rounded-2xl shadow-xl border border-gray-700 dark:border-gray-600 pointer-events-auto">
            <span className="text-sm">
              <span className="font-semibold text-blue-400">{selectedProIds.size}</span>
              {' '}shipment{selectedProIds.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={submitBulkBayanPayment}
              disabled={savingBulkPayment}
              className="flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-medium"
            >
              <DollarSign size={13} />
              {savingBulkPayment ? 'Sending…' : 'Request Bayan Payment'}
            </button>
            <button
              onClick={() => setSelectedProIds(new Set())}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-800 dark:hover:bg-gray-600"
            >
              <X size={13} /> Clear
            </button>
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
  const [showBulkCcro, setShowBulkCcro] = useState(false)
  const [sort, setSort] = useState<SortState>({ column: null, dir: 'asc' })
  const toggleSort = useCallback((column: string) => {
    setSort(s => ({ column, dir: s.column === column && s.dir === 'asc' ? 'desc' : 'asc' }))
    setPage(1)
  }, [])

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

  async function handleBlExport() {
    try {
      const { data } = await shipmentsApi.blExport({
        search: debouncedSearch || undefined,
        stage: (!historical && !isMyQueue) ? (stageFilter || undefined) : undefined,
        my_queue: isMyQueue || undefined,
        missing_date: (!historical && missingDate) || undefined,
        amls_search: debouncedAmlsSearch || undefined,
        missing_amls: missingAmls || undefined,
        pull_out_from: (!historical && pullOutFrom) || undefined,
        pull_out_to: (!historical && pullOutTo) || undefined,
        historical: historical || undefined,
        completed_from: (historical && completedFrom) || undefined,
        completed_to: (historical && completedTo) || undefined,
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

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setPage(1)
  }, [debouncedSearch, stageFilter, missingDate, debouncedAmlsSearch, missingAmls, pullOutFrom, pullOutTo, completedFrom, completedTo])

  const skip = (page - 1) * PAGE_SIZE
  const isMyQueue = !historical && stageFilter === 'my_queue'

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', skip, debouncedSearch, stageFilter, missingDate, debouncedAmlsSearch, missingAmls, pullOutFrom, pullOutTo, sort.column, sort.dir, historical, completedFrom, completedTo],
    queryFn: () => shipmentsApi.list({
      skip,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      stage: (!historical && !isMyQueue) ? (stageFilter || undefined) : undefined,
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
        <div className="flex items-center gap-2">
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
          {user?.team === 'CUSTOMER' && (
            <Link to="/shipments/new" className="flex items-center gap-2 bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap">
              <Plus size={16} /> <span className="hidden sm:inline">New Shipment</span><span className="sm:hidden">New</span>
            </Link>
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
      {showBulkCcro && (
        <BulkCcroUploadModal
          onClose={() => setShowBulkCcro(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
        />
      )}

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
              No date
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
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-3 min-w-[190px]">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Visible columns</p>
                  {ALL_COLUMNS.map(col => (
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
        <ContainerView team={user!.team} historical={historical} />
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
          sort={sort}
          onSort={toggleSort}
          hiddenCols={hiddenCols}
          isMobile={isMobile}
          historical={historical}
        />
      )}

    </div>
  )
}
