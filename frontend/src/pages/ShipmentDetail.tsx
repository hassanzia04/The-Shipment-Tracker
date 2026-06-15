import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import { documentsApi, openDocument } from '@/api/documents'
import { authApi } from '@/api/auth'
import { mastersApi } from '@/api/masters'
import { DocumentUploadPanel } from '@/components/DocumentUploadPanel'
import { StageTimeline } from '@/components/StageTimeline'
import { HoldPanel } from '@/components/HoldPanel'
import { useAuth } from '@/hooks/useAuth'
import { STAGE_LABELS, TASK_TYPE_LABELS, DOC_TYPE_LABELS, ENTITY_LABELS, HOLD_REASON_LABELS, CUSTOMER_REQUIRED_DOCS } from '@/types'
import type { Task, Document as ShipmentDoc, Container, Truck, Shipment, ShipmentStage, DocumentType } from '@/types'
import { formatDate, formatDateTime, formatFileSize } from '@/lib/dates'
import { ChevronDown, ChevronUp, CheckCircle, Clock, AlertTriangle, Info, Upload, Trash2, Download, Pencil, X, Eye } from 'lucide-react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import clsx from 'clsx'
import type { ShipmentEvent } from '@/types'

// Events that carry a remark directed at a specific team
const INBOUND_EVENTS: Record<string, string[]> = {
  CUSTOMER:   ['DOCUMENTS_REJECTED', 'SENT_BACK_TO_CUSTOMER'],
  FFD:        ['SENT_BACK_TO_FFD', 'TASK_COMPLETED', 'TASK_HOLD_RELEASED'],
  PRO:        ['TASK_CREATED', 'TASK_HOLD_RELEASED'],
  TRANSPORT:  ['STAGE_CHANGED'],
  DC:         ['STAGE_CHANGED'],
}

// Stages where each team is the active owner
const TEAM_ACTIVE_STAGE: Partial<Record<string, ShipmentStage[]>> = {
  CUSTOMER:  ['CUSTOMER'],
  FFD:       ['FFD_REVIEW', 'IN_PROGRESS'],
  PRO:       ['IN_PROGRESS'],
  TRANSPORT: ['TRANSPORT', 'DC_TRANSPORT'],
  DC:        ['DC_TRANSPORT'],
}

function getLatestRemarkForTeam(
  events: ShipmentEvent[],
  tasks: { id: string; assigned_team: string }[],
  team: string,
  currentStage: ShipmentStage,
): ShipmentEvent | null {
  const activeStages = TEAM_ACTIVE_STAGE[team] || []
  if (!activeStages.includes(currentStage)) return null

  const relevant = INBOUND_EVENTS[team] || []
  const taskTeamById = Object.fromEntries(tasks.map(t => [t.id, t.assigned_team]))

  return [...events].reverse().find(e => {
    if (!relevant.includes(e.event_type) || !e.remark) return false
    // For TASK_CREATED, only show the event if the linked task belongs to this team
    if (e.event_type === 'TASK_CREATED' && e.task_id) {
      return taskTeamById[e.task_id] === team
    }
    return true
  }) || null
}

const OBSERVER_STATUS_CONFIGS = [
  {
    eventTypes: ['SENT_BACK_TO_CUSTOMER', 'DOCUMENTS_REJECTED'],
    targetTeam: 'CUSTOMER',
    stage: 'CUSTOMER' as ShipmentStage,
    label: 'Waiting for customer — shipment returned for re-submission',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-300 dark:border-amber-700',
  },
  {
    eventTypes: ['SENT_BACK_TO_FFD'],
    targetTeam: 'FFD',
    stage: 'FFD_REVIEW' as ShipmentStage,
    label: 'Returned to FFD for review',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-300 dark:border-amber-700',
  },
]

function getObserverStatusBanner(
  events: ShipmentEvent[],
  team: string,
  currentStage: ShipmentStage,
): { event: ShipmentEvent; label: string; bg: string; border: string } | null {
  for (const config of OBSERVER_STATUS_CONFIGS) {
    if (team === config.targetTeam || currentStage !== config.stage) continue
    const event = [...events].reverse().find(e => config.eventTypes.includes(e.event_type) && e.remark)
    if (event) return { event, label: config.label, bg: config.bg, border: config.border }
  }
  return null
}

const REMARK_STYLE: Record<string, { bg: string; border: string; icon: JSX.Element; label: string }> = {
  DOCUMENTS_REJECTED:    { bg: 'bg-red-50', border: 'border-red-300', icon: <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />, label: 'Documents sent back by FFD team' },
  SENT_BACK_TO_FFD:      { bg: 'bg-amber-50', border: 'border-amber-300', icon: <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />, label: 'Shipment returned to FFD' },
  SENT_BACK_TO_CUSTOMER: { bg: 'bg-amber-50', border: 'border-amber-300', icon: <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />, label: 'Shipment sent back by FFD — please review and re-submit' },
  TASK_CREATED:          { bg: 'bg-blue-50', border: 'border-blue-300', icon: <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />, label: 'New task assigned to your team' },
  TASK_COMPLETED:        { bg: 'bg-green-50', border: 'border-green-300', icon: <CheckCircle size={18} className="text-green-500 shrink-0 mt-0.5" />, label: 'Task completed' },
  TASK_HOLD_RELEASED:    { bg: 'bg-green-50', border: 'border-green-300', icon: <CheckCircle size={18} className="text-green-500 shrink-0 mt-0.5" />, label: 'Hold released' },
  STAGE_CHANGED:         { bg: 'bg-blue-50', border: 'border-blue-300', icon: <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />, label: 'Shipment assigned to your team' },
}

function getContainerDisplayLabel(status: string, shipmentStage: string): { label: string; color: string } {
  if (status === 'PENDING') {
    return shipmentStage === 'TRANSPORT' || shipmentStage === 'DC_TRANSPORT'
      ? { label: 'Transport Allocating Trucks', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' }
      : { label: 'Pending', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' }
  }
  const map: Record<string, { label: string; color: string }> = {
    ASSIGNED:   { label: 'Trucks Assigned',   color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
    IN_TRANSIT: { label: 'In Transit',         color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
    AT_DC:          { label: 'Reported to DC',     color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
    BREAKDOWN:      { label: 'Breakdown',          color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    OFFLOADED:      { label: 'Offloaded',          color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    RETURNED:       { label: 'Returned',           color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
    CCRO_RETURNED:  { label: 'CCRO Returned to FFD', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
    CLOSED:         { label: 'Closed',             color: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
  }
  return map[status] ?? { label: status, color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' }
}

function DocChecklist({ documents, shipment }: { documents: ShipmentDoc[], shipment: Shipment }) {
  const uploadedTypes = new Set(documents.map(d => d.doc_type))

  const customerRows = [
    { type: 'COMMERCIAL_INVOICE', label: 'Commercial Invoice' },
    { type: 'PACKING_LIST',       label: 'Packing List' },
    { type: 'CERT_OF_ORIGIN',     label: 'Cert. of Origin' },
    { type: 'HALAL_CERT',         label: 'Halal Certificate' },
    { type: 'BL',                 label: 'Bill of Lading' },
    { type: 'HEALTH_CERT',        label: 'Health Certificate' },
  ]

  const hasPermit = shipment.tasks.some(t => t.task_type === 'PERMIT')
  const hasBayan  = shipment.tasks.some(t => t.task_type === 'BAYAN')
  const hasDo     = shipment.tasks.some(t => t.task_type === 'DO')
  const hasCcro   = shipment.tasks.some(t => t.task_type === 'CCRO')

  const totalContainers = shipment.containers.length
  const containersWithCcro = shipment.containers.filter(c =>
    documents.some(d => d.container_id === c.id && d.doc_type === 'CCRO')
  ).length

  const processRows = [
    hasPermit && { type: 'PERMIT', label: 'Permit',         done: uploadedTypes.has('PERMIT'), note: undefined as string | undefined },
    hasBayan  && { type: 'BAYAN',  label: 'Bayan',          done: uploadedTypes.has('BAYAN'),  note: undefined },
    hasDo     && { type: 'DO',     label: 'Delivery Order', done: uploadedTypes.has('DO'),     note: undefined },
    hasCcro && totalContainers > 0 && {
      type: 'CCRO', label: 'CCRO',
      done: containersWithCcro === totalContainers,
      note: `${containersWithCcro}/${totalContainers}`,
    },
  ].filter(Boolean) as { type: string; label: string; done: boolean; note?: string }[]

  const missingCustomer = customerRows.filter(r => !uploadedTypes.has(r.type as DocumentType)).length
  const missingProcess  = processRows.filter(r => !r.done).length
  const allDone = missingCustomer === 0 && missingProcess === 0

  return (
    <div className="sticky top-6 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3">
      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Documents</p>

      {/* Customer docs */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-gray-300 dark:text-gray-600 uppercase tracking-wide">Customer</p>
        {customerRows.map(r => {
          const done = uploadedTypes.has(r.type as DocumentType)
          return (
            <div key={r.type} className="flex items-center gap-2">
              {done
                ? <CheckCircle size={12} className="text-green-500 shrink-0" />
                : <div className="w-3 h-3 rounded-full border-2 border-gray-300 dark:border-gray-600 shrink-0" />}
              <span className={clsx('text-xs leading-tight', done ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500')}>
                {r.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Process docs */}
      {processRows.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t dark:border-gray-700">
          <p className="text-[10px] font-semibold text-gray-300 dark:text-gray-600 uppercase tracking-wide">Process</p>
          {processRows.map(r => (
            <div key={r.type} className="flex items-center gap-2">
              {r.done
                ? <CheckCircle size={12} className="text-green-500 shrink-0" />
                : <div className="w-3 h-3 rounded-full border-2 border-gray-300 dark:border-gray-600 shrink-0" />}
              <span className={clsx('text-xs flex-1 leading-tight', r.done ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500')}>
                {r.label}
              </span>
              {r.note && <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{r.note}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Summary footer */}
      <div className="pt-3 border-t dark:border-gray-700">
        {allDone ? (
          <p className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
            <CheckCircle size={12} /> All complete
          </p>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {[
              missingCustomer > 0 && `${missingCustomer} customer`,
              missingProcess  > 0 && `${missingProcess} process`,
            ].filter(Boolean).join(' · ')} missing
          </p>
        )}
      </div>
    </div>
  )
}

async function handleDownloadDoc(doc: ShipmentDoc) {
  try {
    const { data } = await documentsApi.getUrl(doc.id)
    const a = document.createElement('a')
    a.href = data.url
    a.click()
  } catch {
    toast.error('Failed to download')
  }
}

export function ShipmentDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: shipment, isLoading } = useQuery({
    queryKey: ['shipment', id],
    queryFn: () => shipmentsApi.get(id!).then(r => r.data),
  })

  const { data: documents = [] } = useQuery<ShipmentDoc[]>({
    queryKey: ['documents', id],
    queryFn: () => documentsApi.list(id!).then(r => r.data),
  })

  const { data: proUsers = [] } = useQuery({
    queryKey: ['team-workload', 'PRO'],
    queryFn: () => authApi.listTeamWorkload('PRO').then(r => r.data),
    enabled: user?.team === 'FFD',
  })

  const { data: trucks = [] } = useQuery<Truck[]>({
    queryKey: ['trucks'],
    queryFn: () => mastersApi.trucks.list().then(r => r.data),
    enabled: user?.team === 'TRANSPORT' || user?.team === 'DC',
  })

  const [remark, setRemark] = useState('')
  const [customerRemark, setCustomerRemark] = useState('')
  const [showTimeline, setShowTimeline] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [closingContainerId, setClosingContainerId] = useState<string | null>(null)
  const [closeRemark, setCloseRemark] = useState('')
  const [showSendBack, setShowSendBack] = useState(false)
  const [sendBackRemark, setSendBackRemark] = useState('')
  const [showDelegateRop, setShowDelegateRop] = useState(false)
  const [delegateRopRemark, setDelegateRopRemark] = useState('')
  const [showRecall, setShowRecall] = useState(false)
  const [recallRemark, setRecallRemark] = useState('')
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [dateInput, setDateInput] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  async function savePullOutDate() {
    if (!dateInput) return
    setSavingDate(true)
    try {
      await shipmentsApi.update(id!, { pull_out_date: dateInput })
      toast.success('Pull-out date updated')
      refresh()
      setEditingDate(false)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update date')
    } finally {
      setSavingDate(false)
    }
  }

  async function handleDownloadAll() {
    setDownloadingAll(true)
    try {
      const { data } = await documentsApi.downloadAll(id!)
      const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `BL_${shipment?.bl_number ?? id}_documents.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download documents')
    } finally {
      setDownloadingAll(false)
    }
  }

  

  function refresh() {
    qc.invalidateQueries({ queryKey: ['shipment', id] })
    qc.invalidateQueries({ queryKey: ['documents', id] })
    qc.invalidateQueries({ queryKey: ['shipments'] })
  }

  async function handleDeleteShipment() {
    setSubmitting(true)
    try {
      await shipmentsApi.delete(id!)
      toast.success('Shipment deleted')
      qc.invalidateQueries({ queryKey: ['shipments'] })
      navigate('/shipments')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to delete shipment')
      setSubmitting(false)
      setShowDeleteConfirm(false)
    }
  }

  async function action(fn: () => Promise<any>, successMsg: string) {
    setSubmitting(true)
    try {
      await fn()
      toast.success(successMsg)
      refresh()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Action failed')
    } finally {
      setSubmitting(false)
      setRemark('')
    }
  }

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-100 dark:bg-gray-800 rounded w-64" /><div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl" /></div>
  if (!shipment) return <p className="text-gray-500">Shipment not found</p>

  const team = user!.team
  const stage = shipment.current_stage
  const isTransportOrDc = team === 'TRANSPORT' || team === 'DC'

  // PRO users only see tasks explicitly assigned to them
  const visibleTasks = team === 'PRO'
    ? shipment.tasks.filter(t => t.assigned_to_id === user!.id)
    : shipment.tasks

  const activeTasks = visibleTasks.filter(t => t.status !== 'COMPLETED')
  const myTasks = activeTasks.filter(t => t.assigned_team === team)
  const latestRemark = getLatestRemarkForTeam(shipment.events || [], shipment.tasks, team, stage)
  const observerBanner = getObserverStatusBanner(shipment.events || [], team, stage)

  const customerDocs = documents.filter(d => ['COMMERCIAL_INVOICE','PACKING_LIST','CERT_OF_ORIGIN','HALAL_CERT','BL','HEALTH_CERT','MISCELLANEOUS'].includes(d.doc_type))
  const processDocs = documents.filter(d => !['COMMERCIAL_INVOICE','PACKING_LIST','CERT_OF_ORIGIN','HALAL_CERT','BL','HEALTH_CERT'].includes(d.doc_type))

  const ccroTask = shipment.tasks.find(t => t.task_type === 'CCRO' && t.status !== 'COMPLETED')
  const allContainersHaveCcro = shipment.containers.length > 0 &&
    shipment.containers.every(c => documents.some(d => d.container_id === c.id && d.doc_type === 'CCRO'))
  const confirmBlockReason: string | null =
    !shipment.do_validity_date ? 'DO validity date must be set first' :
    !allContainersHaveCcro ? 'Upload one CCRO per container before confirming' :
    null

  return (
    <div className="lg:flex lg:gap-6 lg:items-start">
    <div className="flex-1 min-w-0 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">BL: {shipment.bl_number}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Invoice: {shipment.invoice_number}</p>
          {[
            { label: 'Product', value: shipment.product_type_name },
            { label: 'Loading Port', value: shipment.loading_port_name },
            { label: 'Shipping Line', value: shipment.shipping_line_name },
            { label: 'Offloading', value: shipment.offloading_point_name },
          ].filter(item => item.value).length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {[
                { label: 'Product', value: shipment.product_type_name },
                { label: 'Loading Port', value: shipment.loading_port_name },
                { label: 'Shipping Line', value: shipment.shipping_line_name },
                { label: 'Offloading', value: shipment.offloading_point_name },
              ].filter(item => item.value).map(item => (
                <span key={item.label} className="text-xs text-gray-500 dark:text-gray-400">
                  <span className="text-gray-400 dark:text-gray-500">{item.label}: </span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{item.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium px-3 py-1 rounded-full bg-blue-100 text-blue-700">
            {STAGE_LABELS[stage]}
          </span>
          <button
            onClick={handleDownloadAll}
            disabled={downloadingAll || documents.length === 0}
            className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 dark:border-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
          >
            <Download size={13} /> {downloadingAll ? 'Zipping…' : 'Download All'}
          </button>
          {user?.team === 'CUSTOMER' && stage === 'CUSTOMER' && (
            <button
              onClick={() => setShowDeleteConfirm(v => !v)}
              className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
          {user?.is_admin && (
            <button
              onClick={async () => {
                if (!confirm(`Delete shipment BL: ${shipment.bl_number}? This permanently removes all data.`)) return
                try {
                  await shipmentsApi.delete(id!)
                  toast.success('Shipment deleted')
                  navigate('/shipments')
                } catch (e: any) {
                  toast.error(e.response?.data?.detail || 'Failed to delete')
                }
              }}
              className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation — customer only, stage CUSTOMER */}
      {showDeleteConfirm && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">Delete this shipment?</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              This will permanently remove <strong>BL: {shipment.bl_number}</strong> and all uploaded documents. This cannot be undone.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleDeleteShipment}
                disabled={submitting}
                className="text-xs bg-red-600 text-white px-4 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {submitting ? 'Deleting…' : 'Yes, delete permanently'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-2 py-1.5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hold banner — visible to all teams whenever any task is on hold */}
      {shipment.tasks.some(t => t.status === 'ON_HOLD') && (
        <div className="space-y-2">
          {shipment.tasks.filter(t => t.status === 'ON_HOLD').map(task => (
            <div key={task.id} className="flex gap-3 p-4 rounded-xl border bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700">
              <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                    On Hold — {TASK_TYPE_LABELS[task.task_type]}
                  </p>
                  <span className="text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                    {task.assigned_team}
                  </span>
                  {task.assigned_to_name && (
                    <span className="text-xs text-amber-600 dark:text-amber-500">· {task.assigned_to_name}</span>
                  )}
                </div>
                {task.hold_entity && (
                  <p className="text-sm text-amber-800 dark:text-amber-400 mt-0.5">
                    Held by: <span className="font-medium">{ENTITY_LABELS[task.hold_entity as keyof typeof ENTITY_LABELS] ?? task.hold_entity}</span>
                    {task.hold_reason && (
                      <span className="text-amber-700 dark:text-amber-500"> · {HOLD_REASON_LABELS[task.hold_reason as keyof typeof HOLD_REASON_LABELS] ?? task.hold_reason}</span>
                    )}
                  </p>
                )}
                {task.hold_remark && (
                  <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5 italic">"{task.hold_remark}"</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Observer status banner — shown to all non-target teams to surface where the shipment is waiting */}
      {observerBanner && (
        <div className={clsx('flex gap-3 p-4 rounded-xl border', observerBanner.bg, observerBanner.border)}>
          <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{observerBanner.label}</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">"{observerBanner.event.remark}"</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatDateTime(observerBanner.event.created_at)}</p>
          </div>
        </div>
      )}

      {/* Transport / DC: split layout */}
      {isTransportOrDc && (
        <TransportDcLayout
          shipment={shipment}
          trucks={trucks}
          team={team}
          stage={stage}
          submitting={submitting}
          action={action}
          shipmentId={id!}
          onUpdated={refresh}
          documents={documents}
        />
      )}

      {/* Overview content — all other teams */}
      {!isTransportOrDc && <>

      {/* Action banner — most recent remark directed at this team */}
      {latestRemark && (() => {
        const style = REMARK_STYLE[latestRemark.event_type] || REMARK_STYLE['STAGE_CHANGED']
        return (
          <div className={clsx('flex gap-3 p-4 rounded-xl border', style.bg, style.border)}>
            {style.icon}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">{style.label}</p>
              <p className="text-sm text-gray-700 mt-0.5">"{latestRemark.remark}"</p>
              <p className="text-xs text-gray-400 mt-1">{formatDateTime(latestRemark.created_at)}</p>
            </div>
          </div>
        )
      })()}

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 text-sm">
        {shipment.do_validity_date && (() => {
          const days = differenceInCalendarDays(parseISO(shipment.do_validity_date!), new Date())
          const urgency = days < 0
            ? { color: 'text-red-600 dark:text-red-400', label: `${Math.abs(days)}d overdue` }
            : days <= 3
            ? { color: 'text-red-500 dark:text-red-400', label: `${days}d left` }
            : days <= 7
            ? { color: 'text-amber-600 dark:text-amber-400', label: `${days}d left` }
            : { color: 'text-green-600 dark:text-green-400', label: `${days}d left` }
          return (
            <div className="col-span-2 flex items-center justify-between p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div>
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">DO Validity Date</span>
                <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{formatDate(shipment.do_validity_date)}</p>
              </div>
              <span className={clsx('text-sm font-bold', urgency.color)}>{urgency.label}</span>
            </div>
          )
        })()}
        <div>
          <span className="text-gray-500 dark:text-gray-400">Planned Pull Out Date</span>
          {team === 'CUSTOMER' && editingDate ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="date"
                value={dateInput}
                onChange={e => setDateInput(e.target.value)}
                className="border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={savePullOutDate}
                disabled={savingDate || !dateInput}
                className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {savingDate ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingDate(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-0.5">
              <p className="font-medium dark:text-gray-100">{formatDate(shipment.pull_out_date)}</p>
              {team === 'CUSTOMER' && (
                <button
                  onClick={() => { setDateInput(shipment.pull_out_date ?? ''); setEditingDate(true) }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="Edit pull-out date"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
        </div>
        <div><span className="text-gray-500 dark:text-gray-400">Created</span><p className="font-medium dark:text-gray-100">{formatDate(shipment.created_at)}</p></div>
        {shipment.completed_at && <div><span className="text-gray-500 dark:text-gray-400">Completed</span><p className="font-medium dark:text-gray-100">{formatDate(shipment.completed_at)}</p></div>}
      </div>

      {/* Customer Documents */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Shipment Documents</h2>
        <DocumentUploadPanel
          shipmentId={id!}
          documents={customerDocs}
          onUploaded={refresh}
          readonly={!(stage === 'CUSTOMER' && team === 'CUSTOMER')}
        />
        {/* Submit button */}
        {stage === 'CUSTOMER' && team === 'CUSTOMER' && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Remarks for FFD team <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea
                value={customerRemark}
                onChange={e => setCustomerRemark(e.target.value)}
                rows={2}
                placeholder="Any notes or context for the FFD team…"
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div>
              <button
                onClick={() => action(() => shipmentsApi.submit(id!, customerRemark.trim() || undefined), 'Documents submitted to FFD team')}
                disabled={submitting || !CUSTOMER_REQUIRED_DOCS.every(t => customerDocs.some(d => d.doc_type === t))}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Submit for Review
              </button>
              {!CUSTOMER_REQUIRED_DOCS.every(t => customerDocs.some(d => d.doc_type === t)) && (
                <p className="text-xs text-amber-600 mt-1">Upload your required documents before submitting</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* FFD Review actions */}
      {stage === 'FFD_REVIEW' && team === 'FFD' && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Review Documents</h2>
          <textarea value={remark} onChange={e => setRemark(e.target.value)} placeholder="Reason for sending back (required)…" className="w-full border dark:border-gray-600 rounded-lg p-2 text-sm resize-none h-20 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
          {!CUSTOMER_REQUIRED_DOCS.every(t => customerDocs.some(d => d.doc_type === t)) && (
            <p className="text-xs text-amber-600">Split the combined PDF into all 6 documents before approving.</p>
          )}
          <div className="flex gap-2">
            <button onClick={() => action(() => shipmentsApi.rejectDocs(id!, remark), 'Sent back to customer')} disabled={!remark.trim() || submitting} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-600 disabled:opacity-50">
              Send Back
            </button>
            <button
              onClick={() => action(() => shipmentsApi.approveDocs(id!), 'Approved — Permit + DO tasks opened')}
              disabled={submitting || !CUSTOMER_REQUIRED_DOCS.every(t => customerDocs.some(d => d.doc_type === t))}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Approve &amp; Open Tasks
            </button>
          </div>
        </div>
      )}

      {/* Active tasks */}
      {shipment.tasks.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Tasks</h2>
          {visibleTasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              shipmentId={id!}
              userTeam={team}
              userId={user!.id}
              proUsers={proUsers}
              doValidityDate={shipment.do_validity_date}
              documents={documents}
              onUpdated={refresh}
              submitting={submitting}
              onComplete={() => action(() => shipmentsApi.completeTask(id!, task.id), 'Task completed')}
            />
          ))}

          {/* PRO action buttons */}
          {team === 'PRO' && stage === 'IN_PROGRESS' &&
           shipment.tasks.some(t => t.task_type === 'BAYAN' && t.status !== 'COMPLETED') && (() => {
            const bp = shipment.tasks.find(t => t.task_type === 'BAYAN_PAYMENT')
            return (
              <div className="pt-2 border-t dark:border-gray-700">
                {!bp && (
                  <button
                    onClick={() => action(() => shipmentsApi.requestBayanPayment(id!), 'Payment request sent to customer')}
                    disabled={submitting}
                    className="text-sm bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                  >
                    Request Customer Payment (Bayan)
                  </button>
                )}
                {bp?.status === 'IN_PROGRESS' && (
                  <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg">
                    <Clock size={14} className="shrink-0" />
                    Bayan payment requested — awaiting customer confirmation
                  </div>
                )}
                {bp?.status === 'COMPLETED' && (
                  <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2 rounded-lg">
                    <CheckCircle size={14} className="shrink-0" />
                    Payment confirmed by customer
                    {bp.completed_at && (
                      <span className="text-xs text-green-600 dark:text-green-500 ml-1">· {formatDateTime(bp.completed_at)}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* FFD action buttons based on task state */}
          {team === 'FFD' && stage === 'IN_PROGRESS' && (
            <div className="flex flex-wrap gap-2 pt-2 border-t dark:border-gray-700">
              {!shipment.tasks.some(t => t.task_type === 'BAYAN') && (
                <button onClick={() => action(() => shipmentsApi.openBayan(id!), 'Bayan task opened')} disabled={submitting} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  Open Bayan Task
                </button>
              )}
              {shipment.tasks.some(t => t.task_type === 'DO' && t.status === 'COMPLETED') && shipment.tasks.some(t => t.task_type === 'BAYAN' && t.status === 'COMPLETED') && !shipment.tasks.some(t => t.task_type === 'CCRO') && (
                <button onClick={() => action(() => shipmentsApi.openCcro(id!), 'CCRO task opened')} disabled={submitting} className="text-sm bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
                  Open CCRO Task
                </button>
              )}
              {shipment.tasks.some(t => t.task_type === 'CCRO' && t.status !== 'COMPLETED') && !shipment.tasks.some(t => t.task_type === 'CCRO_ROP' && t.status !== 'COMPLETED') && (
                !showDelegateRop ? (
                  <button
                    onClick={() => setShowDelegateRop(true)}
                    disabled={submitting}
                    className="text-sm border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 px-3 py-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50"
                  >
                    Raise ROP Issue
                  </button>
                ) : (
                  <div className="w-full bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">Raise ROP Issue — Delegate to PRO</p>
                    <p className="text-xs text-purple-600 dark:text-purple-400">This will open a task for PRO on hold with ROP. Describe the specific issue so PRO knows what to resolve.</p>
                    <textarea
                      value={delegateRopRemark}
                      onChange={e => setDelegateRopRemark(e.target.value)}
                      placeholder="Describe the ROP issue (required)…"
                      className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 resize-none h-16"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!delegateRopRemark.trim()) { toast.error('Describe the ROP issue before delegating'); return }
                          await action(() => shipmentsApi.delegateCcroRop(id!, delegateRopRemark), 'ROP issue raised — PRO notified')
                          setShowDelegateRop(false)
                          setDelegateRopRemark('')
                        }}
                        disabled={submitting || !delegateRopRemark.trim()}
                        className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50"
                      >
                        {submitting ? 'Saving…' : 'Raise Issue'}
                      </button>
                      <button onClick={() => { setShowDelegateRop(false); setDelegateRopRemark('') }} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* FFD: send back to customer (IN_PROGRESS only) */}
      {team === 'FFD' && stage === 'IN_PROGRESS' && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
          {!showSendBack ? (
            <button
              onClick={() => setShowSendBack(true)}
              className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              <AlertTriangle size={14} /> Send Back to Customer
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Send Back to Customer</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  The shipment returns to CUSTOMER stage. Completed tasks and uploaded documents are preserved. The customer will be notified and must re-submit.
                </p>
              </div>
              <textarea
                value={sendBackRemark}
                onChange={e => setSendBackRemark(e.target.value)}
                placeholder="Explain what the customer needs to address (required)…"
                className="w-full text-sm border dark:border-gray-600 rounded-lg p-2.5 h-20 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => action(() => shipmentsApi.sendBackToCustomer(id!, sendBackRemark), 'Sent back to customer').then(() => { setShowSendBack(false); setSendBackRemark('') })}
                  disabled={submitting || !sendBackRemark.trim()}
                  className="text-sm bg-amber-600 text-white px-4 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? 'Sending…' : 'Confirm Send Back'}
                </button>
                <button onClick={() => { setShowSendBack(false); setSendBackRemark('') }} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Containers — visible to all non-Transport/DC teams from creation */}
      {!isTransportOrDc && (shipment.containers.length > 0 || (shipment.container_count != null && shipment.container_count > 0) || (team === 'FFD' && stage === 'IN_PROGRESS' && !!ccroTask)) && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">
            Containers ({shipment.containers.length}{shipment.container_count != null && shipment.container_count !== shipment.containers.length ? ` / ${shipment.container_count} declared` : ''})
          </h2>

          {/* No containers entered yet — show declared count as pending */}
          {shipment.containers.length === 0 && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 shrink-0">
                Pending
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {shipment.container_count != null
                  ? `${shipment.container_count} container${shipment.container_count !== 1 ? 's' : ''} declared — not yet entered`
                  : 'No containers entered yet'}
              </span>
            </div>
          )}

          {shipment.containers.map(c => {
            const truck = trucks.find(t => t.id === c.truck_id)
            const ccroDoc = documents.find(d => d.container_id === c.id && d.doc_type === 'CCRO')
            const { label: statusLabel, color: statusColor } = getContainerDisplayLabel(c.status, stage)
            return (
              <div key={c.id} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium dark:text-gray-100">{c.container_number}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', statusColor)}>{statusLabel}</span>
                      {c.expected_arrival_at && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">ETA {formatDateTime(c.expected_arrival_at)}</span>
                      )}
                      {truck && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{truck.plate_number} — {truck.driver_name}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {shipment.pull_out_date && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">Planned pull out: <span className="text-gray-600 dark:text-gray-300 font-medium">{formatDate(shipment.pull_out_date)}</span></span>
                      )}
                      {c.actual_pull_out_date && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">Actual pull out: <span className="text-gray-600 dark:text-gray-300 font-medium">{formatDateTime(c.actual_pull_out_date)}</span></span>
                      )}
                      {c.offloaded_at && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">Offloaded: <span className="text-green-600 dark:text-green-400 font-medium">{formatDateTime(c.offloaded_at)}</span></span>
                      )}
                    </div>
                    {c.status === 'DO_REVALIDATION' && c.revalidation_remark && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 italic mt-0.5">{c.revalidation_remark}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    {team === 'FFD' && stage === 'IN_PROGRESS' && c.status === 'PENDING' && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete container ${c.container_number}? This cannot be undone.`)) return
                          try {
                            await shipmentsApi.deleteContainer(id!, c.id)
                            refresh()
                            toast.success(`${c.container_number} deleted`)
                          } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed to delete') }
                        }}
                        className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-red-200 dark:border-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Delete container"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    {team === 'FFD' && c.status === 'DO_REVALIDATION' && (
                      <button
                        onClick={() => action(() => shipmentsApi.markDoRevalidated(id!, c.id), 'DO marked as revalidated')}
                        disabled={submitting}
                        className="text-xs bg-rose-600 text-white px-2.5 py-1 rounded hover:bg-rose-700 disabled:opacity-50"
                      >
                        Confirm Revalidation
                      </button>
                    )}
                    {team === 'FFD' && c.status === 'CCRO_RETURNED' && (
                      <button
                        onClick={() => action(() => shipmentsApi.resetContainerToTransport(id!, c.id), 'Container re-queued to Transport')}
                        disabled={submitting}
                        className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Resend to Transport
                      </button>
                    )}
                  </div>
                </div>


                {/* CCRO upload slot — one per container, FFD when CCRO task is active */}
                {team === 'FFD' && !!ccroTask && stage === 'IN_PROGRESS' && (
                  <ContainerCcroSlot
                    shipmentId={id!}
                    container={c}
                    taskId={ccroTask.id}
                    ccroDoc={ccroDoc}
                    onUpdated={refresh}
                  />
                )}

              </div>
            )
          })}

          {/* FFD: bulk CCRO upload + manual add when CCRO task is active */}
          {team === 'FFD' && stage === 'IN_PROGRESS' && !!ccroTask && (
            <div className="space-y-2 pt-2 border-t dark:border-gray-700">
              <BulkCcroUpload shipmentId={id!} onUploaded={refresh} />
              <AddContainerRow shipmentId={id!} onAdded={refresh} />
            </div>
          )}

          {/* FFD: confirm CCROs — blocked with reason until all conditions met */}
          {team === 'FFD' && stage === 'IN_PROGRESS' && shipment.containers.length > 0 && (
            <div className="pt-2 border-t dark:border-gray-700 space-y-1">
              <button
                onClick={() => action(() => shipmentsApi.confirmCcro(id!), 'Sent to Transport')}
                disabled={submitting || !!confirmBlockReason}
                className="text-sm bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm CCROs &amp; Send to Transport
              </button>
              {confirmBlockReason && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{confirmBlockReason}</p>
              )}
            </div>
          )}

        </div>
      )}

      {/* FFD: recall from Transport (TRANSPORT stage, no trucks assigned yet) */}
      {team === 'FFD' && stage === 'TRANSPORT' && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
          {!showRecall ? (
            <button
              onClick={() => setShowRecall(true)}
              className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              <AlertTriangle size={14} /> Recall from Transport
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Recall from Transport</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  The shipment returns to IN_PROGRESS so you can upload missing CCROs and re-confirm. This is only allowed if Transport has not yet assigned any trucks.
                </p>
              </div>
              <textarea
                value={recallRemark}
                onChange={e => setRecallRemark(e.target.value)}
                placeholder="Explain why you are recalling (required)…"
                className="w-full text-sm border dark:border-gray-600 rounded-lg p-2.5 h-20 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => action(() => shipmentsApi.recallFromTransport(id!, recallRemark), 'Recalled from Transport').then(() => { setShowRecall(false); setRecallRemark('') })}
                  disabled={submitting || !recallRemark.trim()}
                  className="text-sm bg-amber-600 text-white px-4 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? 'Recalling…' : 'Confirm Recall'}
                </button>
                <button onClick={() => { setShowRecall(false); setRecallRemark('') }} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Process documents — shown always, directly after tasks */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Process Documents</h2>
        {processDocs.length > 0 ? (
          <div className="space-y-2">
            {processDocs.map(doc => (
              <div key={doc.id} className="flex items-center justify-between text-sm p-2.5 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="min-w-0">
                  <span className="font-medium text-gray-800 dark:text-gray-100">{DOC_TYPE_LABELS[doc.doc_type]}</span>
                  <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs truncate">{doc.original_filename}</span>
                  <span className="text-gray-400 ml-2 text-xs">({formatFileSize(doc.compressed_size_bytes)})</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => openDocument(doc.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleDownloadDoc(doc)}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    Download
                  </button>
                  {(doc.uploaded_by_id === user!.id || user!.is_admin) && (
                    <button
                      onClick={async () => {
                        try {
                          await documentsApi.delete(doc.id)
                          toast.success('Document removed')
                          refresh()
                        } catch { toast.error('Failed to remove') }
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          team !== 'FFD' && <p className="text-sm text-gray-400">No process documents uploaded yet</p>
        )}
        {team === 'FFD' && (
          <div className={clsx(processDocs.length > 0 && 'mt-3 pt-3 border-t dark:border-gray-700')}>
            <FfdMiscUpload shipmentId={id!} onUploaded={refresh} />
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
        <button onClick={() => setShowTimeline(v => !v)} className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-100">
          Audit Trail {showTimeline ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showTimeline && shipment.events && (
          <div className="mt-4">
            <StageTimeline events={shipment.events} tasks={shipment.tasks} />
          </div>
        )}
      </div>

      </>}
    </div>
    {!isTransportOrDc && (team === 'FFD' || team === 'PRO') && (
      <div className="hidden lg:block w-52 shrink-0 sticky top-6">
        <DocChecklist documents={documents} shipment={shipment} />
      </div>
    )}
    </div>
  )
}

// Maps each task type to the document type that must be uploaded to complete it
const TASK_REQUIRED_DOC: Partial<Record<string, string>> = {
  PERMIT: 'PERMIT',
  BAYAN: 'BAYAN',
  DO: 'DO',
}

function TaskRow({ task, shipmentId, userTeam, userId, proUsers, doValidityDate, documents, onUpdated, submitting, onComplete }: {
  task: Task
  shipmentId: string
  userTeam: string
  userId: string
  proUsers: { id: string; full_name: string; active_task_count: number }[]
  doValidityDate: string | null
  documents: ShipmentDoc[]
  onUpdated: () => void
  submitting: boolean
  onComplete: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [permitNotRequired, setPermitNotRequired] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [selectedAssignee, setSelectedAssignee] = useState('')
  const [assignRemark, setAssignRemark] = useState('')
  const [savingAssign, setSavingAssign] = useState(false)
  const [showReassign, setShowReassign] = useState(false)
  const [doValidityInput, setDoValidityInput] = useState(doValidityDate ?? '')
  const [savingValidity, setSavingValidity] = useState(false)

  const isProTask = task.assigned_team === 'PRO'
  const canAssign = userTeam === 'FFD' && isProTask && task.status !== 'COMPLETED'

  async function saveDoValidity() {
    if (!doValidityInput) return
    setSavingValidity(true)
    try {
      await shipmentsApi.setDoValidity(shipmentId, doValidityInput)
      toast.success('DO validity date saved')
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to save')
    } finally {
      setSavingValidity(false)
    }
  }

  async function handleAssign() {
    if (!selectedAssignee) return
    setSavingAssign(true)
    try {
      await shipmentsApi.assignTask(shipmentId, task.id, selectedAssignee, assignRemark || undefined)
      toast.success(task.assigned_to_id ? 'Task reassigned' : 'Task assigned')
      setAssigning(false)
      setShowReassign(false)
      setSelectedAssignee('')
      setAssignRemark('')
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign')
    } finally {
      setSavingAssign(false)
    }
  }

  const canAct = task.assigned_team === userTeam && task.status !== 'COMPLETED' &&
    (userTeam !== 'PRO' || task.assigned_to_id === userId)
  const isCcro = task.task_type === 'CCRO'
  const requiredDocType = TASK_REQUIRED_DOC[task.task_type]
  const uploadedDoc: ShipmentDoc | undefined = requiredDocType
    ? documents.find(d => d.doc_type === requiredDocType && d.task_id === task.id)
    : undefined
  const doValidityMissing = task.task_type === 'DO' && !doValidityDate
  const canComplete = !isCcro && (!requiredDocType || !!uploadedDoc || (task.task_type === 'PERMIT' && permitNotRequired)) && !doValidityMissing
  // Allow re-upload if task is done but doc was deleted afterwards
  const canReupload = task.status === 'COMPLETED' && task.assigned_team === userTeam && requiredDocType && !uploadedDoc && !isCcro

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      await documentsApi.upload({
        shipment_id: shipmentId,
        doc_type: requiredDocType as any,
        file,
        task_id: task.id,
      })
      toast.success(`${requiredDocType} uploaded`)
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={clsx('p-3 rounded-lg border space-y-3', task.status === 'COMPLETED' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : task.status === 'ON_HOLD' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-gray-700 dark:border-gray-600')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {task.status === 'COMPLETED' ? <CheckCircle size={15} className="text-green-500" /> : <Clock size={15} className="text-blue-400" />}
          <span className="text-sm font-medium dark:text-gray-100">{TASK_TYPE_LABELS[task.task_type]}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">({task.assigned_team})</span>
          {task.assigned_to_name && (
            <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
              {task.assigned_to_name}
            </span>
          )}
        </div>
        {canAct && task.status !== 'ON_HOLD' && canComplete && (
          <button onClick={onComplete} disabled={submitting} className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50">
            {task.task_type === 'BAYAN_PAYMENT' ? 'Confirm Payment' : 'Mark Complete'}
          </button>
        )}
      </div>

      {/* Bayan Payment — guidance for the customer */}
      {task.task_type === 'BAYAN_PAYMENT' && canAct && task.status !== 'COMPLETED' && task.status !== 'ON_HOLD' && (
        <div className="border-t dark:border-gray-600 pt-2">
          <div className="flex gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              The PRO team is requesting confirmation that the <span className="font-semibold">Bayan payment</span> has been made. Once you have completed the payment, click <span className="font-semibold">Confirm Payment</span> above.
            </p>
          </div>
        </div>
      )}

      {/* PRO task assignment — FFD assigns to a specific PRO member */}
      {canAssign && task.status !== 'COMPLETED' && (
        <div className="border-t dark:border-gray-600 pt-2">
          {!task.assigned_to_id && !assigning ? (
            <button
              onClick={() => setAssigning(true)}
              className="text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 px-2.5 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
            >
              Assign to PRO member
            </button>
          ) : task.assigned_to_id && !showReassign ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">Assigned to <span className="font-medium text-gray-700 dark:text-gray-200">{task.assigned_to_name}</span></span>
              <button onClick={() => { setShowReassign(true); setSelectedAssignee(task.assigned_to_id ?? '') }} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline">
                Reassign
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={selectedAssignee}
                  onChange={e => setSelectedAssignee(e.target.value)}
                  className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-600 text-gray-900 dark:text-white"
                >
                  <option value="">Select PRO member…</option>
                  {proUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} — {u.active_task_count} active task{u.active_task_count !== 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAssign}
                  disabled={!selectedAssignee || savingAssign}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingAssign ? 'Saving…' : task.assigned_to_id ? 'Reassign' : 'Assign'}
                </button>
                <button onClick={() => { setAssigning(false); setShowReassign(false); setAssignRemark('') }} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  Cancel
                </button>
              </div>
              <input
                value={assignRemark}
                onChange={e => setAssignRemark(e.target.value)}
                placeholder="Reason / note (optional)…"
                className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
          )}
        </div>
      )}

      {/* Document upload section for tasks that require one */}
      {canAct && requiredDocType && task.status !== 'ON_HOLD' && (
        <div className="border-t pt-2 space-y-2">
          {uploadedDoc ? (
            <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-2 py-1.5">
              <CheckCircle size={13} />
              <span className="font-medium">{DOC_TYPE_LABELS[uploadedDoc.doc_type]} uploaded</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => openDocument(uploadedDoc.id)}
                  className="text-blue-600 hover:underline"
                >
                  View
                </button>
                <button
                  onClick={() => handleDownloadDoc(uploadedDoc)}
                  className="text-gray-500 dark:text-gray-400 hover:underline"
                >
                  Download
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500">
                Upload <span className="font-medium">{DOC_TYPE_LABELS[requiredDocType as DocumentType]}</span> to complete this task
              </p>
              <label className={clsx('flex items-center gap-2 border dark:border-gray-600 border-dashed rounded px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 text-xs text-gray-600 dark:text-gray-300', uploading && 'opacity-50 pointer-events-none')}>
                <Upload size={13} />
                {uploading ? 'Uploading…' : `Click to upload ${DOC_TYPE_LABELS[requiredDocType as DocumentType]}`}
                <input type="file" className="hidden" accept=".pdf,image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
              </label>
              {task.task_type === 'PERMIT' && (
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={permitNotRequired} onChange={e => setPermitNotRequired(e.target.checked)} className="rounded" />
                  Permit not required for this shipment
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {/* Re-upload for completed tasks where doc was deleted */}
      {canReupload && (
        <div className="border-t pt-2">
          <p className="text-xs text-amber-600 mb-1.5">Document was deleted — please re-upload to keep record complete</p>
          <label className={clsx('flex items-center gap-2 border border-dashed border-amber-300 rounded px-3 py-2 cursor-pointer hover:bg-amber-50 text-xs text-amber-700', uploading && 'opacity-50 pointer-events-none')}>
            <Upload size={13} />
            {uploading ? 'Uploading…' : `Re-upload ${DOC_TYPE_LABELS[requiredDocType as DocumentType]}`}
            <input type="file" className="hidden" accept=".pdf,image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </label>
        </div>
      )}

      {/* CCRO — upload is per-container in the Containers section */}
      {isCcro && task.status !== 'ON_HOLD' && (
        <div className="border-t dark:border-gray-600 pt-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Upload one CCRO per container in the <span className="font-medium text-gray-700 dark:text-gray-200">Containers</span> section below, then use <span className="font-medium text-gray-700 dark:text-gray-200">Confirm CCROs &amp; Send to Transport</span>.
          </p>
        </div>
      )}

      {/* DO validity date — FFD sets/updates it at any time */}
      {task.task_type === 'DO' && userTeam === 'FFD' && (
        <div className="border-t dark:border-gray-600 pt-2 space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            DO Validity Date <span className="font-normal">(deadline for container return)</span>
            {!doValidityDate && <span className="text-red-500 ml-1">— required to complete this task</span>}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={doValidityInput}
              onChange={e => setDoValidityInput(e.target.value)}
              className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {doValidityInput && doValidityInput !== (doValidityDate ?? '') && (
              <button
                onClick={saveDoValidity}
                disabled={savingValidity}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {savingValidity ? 'Saving…' : 'Save'}
              </button>
            )}
            {doValidityDate && doValidityInput === doValidityDate && (
              <span className="text-xs text-green-600 dark:text-green-400">✓ Set</span>
            )}
          </div>
        </div>
      )}

      {/* Hold panel */}
      {canAct && (
        <div className={clsx(requiredDocType || isCcro || task.task_type === 'DO' ? '' : 'border-t pt-2')}>
          <HoldPanel shipmentId={shipmentId} task={task} userTeam={userTeam as any} onUpdated={onUpdated} />
        </div>
      )}
    </div>
  )
}

function FfdMiscUpload({ shipmentId, onUploaded }: { shipmentId: string; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      await documentsApi.upload({ shipment_id: shipmentId, doc_type: 'MISCELLANEOUS', file })
      toast.success('Misc document uploaded')
      onUploaded()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <label className={clsx(
      'flex items-center gap-2 border border-dashed rounded-lg px-3 py-2 cursor-pointer text-xs transition-colors',
      uploading
        ? 'opacity-50 pointer-events-none border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500'
        : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400'
    )}>
      <Upload size={13} className="shrink-0" />
      {uploading ? 'Uploading…' : 'Upload Misc Document'}
      <input
        type="file"
        className="hidden"
        accept=".pdf,image/*"
        disabled={uploading}
        onChange={e => { if (e.target.files?.[0]) { handleFile(e.target.files[0]); e.target.value = '' } }}
      />
    </label>
  )
}

function BulkCcroUpload({ shipmentId, onUploaded }: { shipmentId: string; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [results, setResults] = useState<null | {
    results: { filename: string; container_number: string | null; status: string; conflict_bl?: string; container_id: string | null }[]
    matched: number; created: number; failed: number; duplicates: number
  }>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  async function handleFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setResults(null)
    try {
      const { data } = await shipmentsApi.bulkCcroUpload(shipmentId, Array.from(files))
      setResults(data)
      if (data.matched + data.created > 0) onUploaded()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Bulk upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleRename(idx: number) {
    if (!results || !editValue.trim()) return
    const row = results.results[idx]
    if (!row.container_id) return
    setRenaming(true)
    try {
      await shipmentsApi.renameContainer(shipmentId, row.container_id, editValue.trim())
      const updated = results.results.map((r, i) => i === idx ? { ...r, container_number: editValue.trim().toUpperCase() } : r)
      setResults({ ...results, results: updated })
      setEditingIdx(null)
      onUploaded()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Rename failed')
    } finally {
      setRenaming(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (uploading) return
    const pdfs = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length > 0) handleFiles(pdfs)
  }

  return (
    <div className="space-y-2">
      <label
        className={clsx(
          'flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg px-4 py-4 cursor-pointer transition-colors',
          uploading
            ? 'opacity-50 pointer-events-none border-gray-300 dark:border-gray-600'
            : dragging
            ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/40 dark:border-blue-400'
            : 'border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400',
        )}
        onDragOver={e => { e.preventDefault(); if (!uploading) setDragging(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
        onDrop={handleDrop}
      >
        <Upload size={20} className="text-blue-400" />
        <div className="text-center">
          <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
            {uploading ? 'Uploading & extracting container numbers…' : dragging ? 'Drop PDFs here' : 'Bulk upload CCROs'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Drag & drop or click — container numbers auto-detected from each PDF
          </p>
        </div>
        <input
          type="file"
          className="hidden"
          multiple
          accept=".pdf"
          disabled={uploading}
          onChange={e => handleFiles(e.target.files)}
        />
      </label>

      {results && (
        <div className="rounded-lg border dark:border-gray-700 overflow-hidden text-xs">
          <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex-wrap">
            <span className="text-green-600 dark:text-green-400 font-medium">✓ {results.created} created</span>
            <span className="text-blue-600 dark:text-blue-400 font-medium">● {results.matched} matched</span>
            {results.failed > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">⚠ {results.failed} not detected</span>}
            {results.duplicates > 0 && <span className="text-red-600 dark:text-red-400 font-medium">✕ {results.duplicates} duplicate — already active</span>}
            <button
              onClick={() => setResults(null)}
              className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Upload again
            </button>
          </div>
          <div className="divide-y dark:divide-gray-700 max-h-52 overflow-y-auto">
            {results.results.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-1.5 gap-3">
                <span className="text-gray-500 dark:text-gray-400 truncate flex-1">{r.filename}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {editingIdx === i ? (
                    <>
                      <input
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value.toUpperCase())}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(i); if (e.key === 'Escape') setEditingIdx(null) }}
                        className="border dark:border-gray-600 rounded px-1.5 py-0.5 text-xs w-32 font-mono bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button onClick={() => handleRename(i)} disabled={renaming} className="text-green-600 hover:text-green-700 disabled:opacity-50">
                        <CheckCircle size={13} />
                      </button>
                      <button onClick={() => setEditingIdx(null)} className="text-gray-400 hover:text-gray-600">
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      {r.container_number
                        ? <span className="font-medium text-gray-800 dark:text-gray-100 font-mono">{r.container_number}</span>
                        : <span className="text-amber-600 dark:text-amber-400 italic">Not detected</span>
                      }
                      {r.container_id && (
                        <button
                          onClick={() => { setEditingIdx(i); setEditValue(r.container_number ?? '') }}
                          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          title="Edit container number"
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                    </>
                  )}
                  {r.status === 'created' && <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded">New</span>}
                  {r.status === 'matched' && <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded">Matched</span>}
                  {r.status === 'duplicate' && (
                    <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">
                      Duplicate — active on {r.conflict_bl}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


function AddContainerRow({ shipmentId, onAdded }: { shipmentId: string, onAdded: () => void }) {
  const [num, setNum] = useState('')
  const [adding, setAdding] = useState(false)
  async function add() {
    if (!num.trim()) return
    setAdding(true)
    try {
      await shipmentsApi.addContainer(shipmentId, num.trim())
      setNum('')
      onAdded()
      toast.success('Container added')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally {
      setAdding(false)
    }
  }
  return (
    <div className="flex gap-2 items-center pt-2 border-t dark:border-gray-700">
      <input value={num} onChange={e => setNum(e.target.value)} placeholder="Container number…" className="flex-1 text-sm border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
      <button onClick={add} disabled={adding || !num.trim()} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
        {adding ? 'Adding…' : 'Add Container'}
      </button>
    </div>
  )
}

function ContainerCcroSlot({ shipmentId, container, taskId, ccroDoc, onUpdated }: {
  shipmentId: string
  container: Container
  taskId: string
  ccroDoc: ShipmentDoc | undefined
  onUpdated: () => void
}) {
  const [uploading, setUploading] = useState(false)

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      await documentsApi.upload({
        shipment_id: shipmentId,
        doc_type: 'CCRO',
        file,
        task_id: taskId,
        container_id: container.id,
      })
      toast.success(`CCRO uploaded for ${container.container_number}`)
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (ccroDoc) {
    return (
      <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded px-2 py-1.5">
        <CheckCircle size={12} className="text-green-600 dark:text-green-400 shrink-0" />
        <span className="text-green-700 dark:text-green-300 font-medium flex-1 truncate">CCRO: {ccroDoc.original_filename}</span>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => openDocument(ccroDoc.id)} className="text-blue-600 hover:underline">View</button>
          <button
            onClick={async () => { try { await documentsApi.delete(ccroDoc.id); onUpdated(); toast.success('Removed') } catch { toast.error('Failed') } }}
            className="text-red-400 hover:text-red-600"
          >
            <X size={11} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <label className={clsx('flex items-center gap-2 border border-dashed dark:border-gray-600 rounded px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 text-xs text-gray-500 dark:text-gray-400', uploading && 'opacity-50 pointer-events-none')}>
      <Upload size={12} />
      {uploading ? 'Uploading…' : `Upload CCRO for ${container.container_number}`}
      <input type="file" className="hidden" accept=".pdf,image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
    </label>
  )
}

function defaultEta() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return { date: d.toLocaleDateString('en-CA'), time: '09:00' }
}

function AssignTruckForm({ shipmentId, containerId, trucks, onAssigned, alwaysOpen }: {
  shipmentId: string
  containerId: string
  trucks: Truck[]
  onAssigned: () => void
  alwaysOpen?: boolean
}) {
  const [show, setShow] = useState(false)
  const [truckId, setTruckId] = useState('')
  const [etaDate, setEtaDate] = useState(() => defaultEta().date)
  const [etaTime, setEtaTime] = useState('09:00')
  const [etaConfirmed, setEtaConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)

  const etaIso = etaDate && etaTime ? new Date(`${etaDate}T${etaTime}`).toISOString() : ''

  function confirmEta() {
    if (etaDate && etaTime) setEtaConfirmed(true)
  }

  function changeEta() {
    setEtaConfirmed(false)
  }

  async function assign() {
    if (!truckId || !etaIso) { toast.error('Select a truck and confirm the ETA'); return }
    setSaving(true)
    try {
      await shipmentsApi.assignTruck(shipmentId, {
        container_id: containerId,
        truck_id: truckId,
        expected_arrival_at: etaIso,
      })
      toast.success('Truck assigned')
      onAssigned()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign')
    } finally {
      setSaving(false)
    }
  }

  if (!show && !alwaysOpen) {
    return (
      <button onClick={() => setShow(true)} className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700">
        Assign Truck &amp; Driver
      </button>
    )
  }

  return (
    <div className="space-y-2.5 p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
      <select
        value={truckId}
        onChange={e => setTruckId(e.target.value)}
        className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
      >
        <option value="">Select truck / driver…</option>
        {trucks.filter(t => t.is_active).map(t => (
          <option key={t.id} value={t.id}>{t.plate_number} — {t.driver_name} ({t.contractor})</option>
        ))}
      </select>

      {/* ETA picker with explicit OK button */}
      {!etaConfirmed ? (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">ETA to DC</p>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={etaDate}
              onChange={e => setEtaDate(e.target.value)}
              className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white"
            />
            <input
              type="time"
              value={etaTime}
              onChange={e => setEtaTime(e.target.value)}
              className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white"
            />
            <button
              onClick={confirmEta}
              disabled={!etaDate || !etaTime}
              className="text-xs bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 font-medium px-3 py-1.5 rounded hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-40"
            >
              OK
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <CheckCircle size={13} className="text-green-500 shrink-0" />
          <span className="text-gray-700 dark:text-gray-200 font-medium">
            ETA: {formatDateTime(etaIso)}
          </span>
          <button onClick={changeEta} className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
            Change
          </button>
        </div>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          onClick={assign}
          disabled={saving || !truckId || !etaConfirmed}
          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Assign'}
        </button>
        <button onClick={() => setShow(false)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
      </div>
    </div>
  )
}

// ── Transport / DC split layout ───────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  PENDING:    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  ASSIGNED:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  IN_TRANSIT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  BREAKDOWN:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  AT_DC:      'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  OFFLOADED:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  RETURNED:   'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', ASSIGNED: 'Assigned', IN_TRANSIT: 'In Transit',
  BREAKDOWN: 'Breakdown', AT_DC: 'At DC', OFFLOADED: 'Offloaded', RETURNED: 'Returned',
}

function TransportDcLayout({ shipment, trucks, team, stage, submitting, action, shipmentId, onUpdated, documents }: {
  shipment: Shipment
  trucks: Truck[]
  team: string
  stage: string
  submitting: boolean
  action: (fn: () => Promise<any>, msg: string) => Promise<void>
  shipmentId: string
  onUpdated: () => void
  documents: ShipmentDoc[]
}) {
  const [showTimeline, setShowTimeline] = useState(false)
  const doValidity = shipment.do_validity_date

  const DC_DONE_STATUSES = ['OFFLOADED', 'RETURNED', 'CLOSED', 'DO_REVALIDATION', 'CCRO_RETURNED']
  const dcVisibleContainers = team === 'DC'
    ? shipment.containers.filter(c => !DC_DONE_STATUSES.includes(c.status))
    : shipment.containers
  const unassigned = shipment.containers.filter(c => c.status === 'PENDING' || c.status === 'BREAKDOWN').length
  const pendingOffload = dcVisibleContainers.filter(c => c.status === 'AT_DC').length
  const dcHealthCertDoc = documents.find(d => d.doc_type === 'DC_HEALTH_CERT')

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-6 items-start">

      {/* ── Left panel: shipment overview ── */}
      <div className="space-y-4">
        {/* Key info */}
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 space-y-3 text-sm">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">BL Number</p>
            <p className="font-semibold text-gray-900 dark:text-white">{shipment.bl_number}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Invoice</p>
            <p className="font-medium dark:text-gray-100">{shipment.invoice_number}</p>
          </div>
          {shipment.pull_out_date && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Planned Pull Out Date</p>
              <p className="font-medium dark:text-gray-100">{formatDate(shipment.pull_out_date)}</p>
            </div>
          )}
          {shipment.offloading_point_name && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Offloading Location</p>
              <p className="font-medium dark:text-gray-100">{shipment.offloading_point_name}</p>
            </div>
          )}
          {shipment.eta_at_port && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">ETA at Port</p>
              <p className="font-medium dark:text-gray-100">{formatDate(shipment.eta_at_port)}</p>
            </div>
          )}
          {shipment.bayan_type_name && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Bayan Type</p>
              <p className="font-medium dark:text-gray-100">{shipment.bayan_type_name}</p>
            </div>
          )}
          {shipment.consignee_name && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Consignee</p>
              <p className="font-medium dark:text-gray-100">{shipment.consignee_name}</p>
            </div>
          )}
        </div>

        {/* DO Validity */}
        {doValidity && (() => {
          const days = differenceInCalendarDays(parseISO(doValidity), new Date())
          const urgency = days < 0
            ? { color: 'text-red-600 dark:text-red-400', label: `${Math.abs(days)}d overdue`, bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' }
            : days <= 3
            ? { color: 'text-red-500 dark:text-red-400', label: `${days}d left`, bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' }
            : days <= 7
            ? { color: 'text-amber-600 dark:text-amber-400', label: `${days}d left`, bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' }
            : { color: 'text-green-600 dark:text-green-400', label: `${days}d left`, bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' }
          return (
            <div className={clsx('flex items-center justify-between p-3 rounded-xl border', urgency.bg)}>
              <div>
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">DO Validity</p>
                <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{formatDate(doValidity)}</p>
              </div>
              <span className={clsx('text-sm font-bold', urgency.color)}>{urgency.label}</span>
            </div>
          )
        })()}

        {/* DC Health Certificate (per BL) */}
        {(team === 'DC' || team === 'PRO') && (
          <div className={clsx(
            'rounded-xl border p-4 space-y-2',
            dcHealthCertDoc
              ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
              : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
          )}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">Health Certificate</p>
              {dcHealthCertDoc
                ? <span className="text-xs font-medium text-green-700 dark:text-green-400">✓ Uploaded</span>
                : <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Missing</span>}
            </div>
            {dcHealthCertDoc ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{dcHealthCertDoc.original_filename}</p>
                <button
                  onClick={() => openDocument(dcHealthCertDoc.id)}
                  className="p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 shrink-0"
                  title="View health certificate"
                >
                  <Eye size={13} />
                </button>
                <button
                  onClick={async () => { await documentsApi.delete(dcHealthCertDoc.id); onUpdated() }}
                  className="p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shrink-0"
                  title="Delete health certificate"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300">
                <Upload size={12} />
                Upload Health Certificate
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={async e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      await documentsApi.upload({ shipment_id: shipmentId, doc_type: 'DC_HEALTH_CERT', file })
                      toast.success('Health certificate uploaded')
                      onUpdated()
                    } catch { toast.error('Upload failed') }
                    e.target.value = ''
                  }}
                />
              </label>
            )}
          </div>
        )}

        {/* Delivery Note (per BL, AMLS only) */}
        {team === 'DC' && shipment.offloading_is_amls && (() => {
          const dnDoc = documents.find(d => d.doc_type === 'DN')
          return (
            <div className={clsx(
              'rounded-xl border p-4 space-y-2',
              dnDoc
                ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
            )}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">Delivery Note (DN)</p>
                {dnDoc
                  ? <span className="text-xs font-medium text-green-700 dark:text-green-400">✓ Uploaded</span>
                  : <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Missing</span>}
              </div>
              {dnDoc ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{dnDoc.original_filename}</p>
                  <button
                    onClick={() => openDocument(dnDoc.id)}
                    className="p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 shrink-0"
                    title="View delivery note"
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    onClick={async () => { await documentsApi.delete(dnDoc.id); onUpdated() }}
                    className="p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shrink-0"
                    title="Delete delivery note"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300">
                  <Upload size={12} />
                  Upload Delivery Note
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      try {
                        await documentsApi.upload({ shipment_id: shipmentId, doc_type: 'DN', file })
                        toast.success('Delivery Note uploaded')
                        onUpdated()
                      } catch { toast.error('Upload failed') }
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
            </div>
          )
        })()}

        {/* Audit trail */}
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
          <button
            onClick={() => setShowTimeline(v => !v)}
            className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-100"
          >
            Audit Trail {showTimeline ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showTimeline && shipment.events && (
            <div className="mt-4"><StageTimeline events={shipment.events} tasks={shipment.tasks} /></div>
          )}
        </div>
      </div>

      {/* ── Right panel: containers table ── */}
      <div className="space-y-4">
        {/* Summary stat */}
        {team === 'TRANSPORT' && unassigned > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
            <AlertTriangle size={15} className="text-amber-500 shrink-0" />
            <span className="font-medium text-amber-800 dark:text-amber-300">
              {unassigned} container{unassigned !== 1 ? 's' : ''} need{unassigned === 1 ? 's' : ''} a truck assigned
            </span>
          </div>
        )}
        {team === 'DC' && pendingOffload > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
            <Info size={15} className="text-blue-500 shrink-0" />
            <span className="font-medium text-blue-800 dark:text-blue-300">
              {pendingOffload} container{pendingOffload !== 1 ? 's' : ''} pending offloading
            </span>
          </div>
        )}

      {/* Containers table */}
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
          {shipment.containers.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 p-4">No containers on this shipment yet.</p>
          ) : (
            <div className="overflow-x-auto">
            <>
              {/* Table header */}
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1.2fr_1.2fr_1.2fr_1.2fr_auto] gap-3 px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 min-w-[1000px]">
                <span>Container</span>
                <span>Truck</span>
                <span>Driver</span>
                <span>Status</span>
                <span>DC Location</span>
                <span>Planned Pull Out</span>
                <span>Actual Pull Out</span>
                <span>Offloaded</span>
                <span></span>
              </div>

              {/* Rows */}
              {shipment.containers.map(c => (
                <ContainerTableRow
                  key={c.id}
                  container={c}
                  truck={trucks.find(t => t.id === c.truck_id)}
                  shipmentId={shipmentId}
                  team={team}
                  trucks={trucks}
                  submitting={submitting}
                  action={action}
                  onUpdated={onUpdated}
                  offloadingPointName={shipment.offloading_point_name}
                  plannedPullOutDate={shipment.pull_out_date}
                  documents={documents}
                />
              ))}
            </>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ContainerTableRow({ container, truck, shipmentId, team, trucks, submitting, action, onUpdated, offloadingPointName, plannedPullOutDate, documents }: {
  container: Container
  truck: Truck | undefined
  shipmentId: string
  team: string
  trucks: Truck[]
  submitting: boolean
  action: (fn: () => Promise<any>, msg: string) => Promise<void>
  onUpdated: () => void
  offloadingPointName: string | null | undefined
  plannedPullOutDate: string | null | undefined
  documents: ShipmentDoc[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [expandMode, setExpandMode] = useState<'assign' | 'issue' | null>(null)

  const isTransport = team === 'TRANSPORT'
  const isDC = team === 'DC'
  const needsAssign = isTransport && (container.status === 'PENDING' || container.status === 'BREAKDOWN')
  const canIssue = isTransport && !!truck && (container.status === 'ASSIGNED' || container.status === 'IN_TRANSIT')
  const DC_ACTION_STATUSES = ['AT_DC']
  const canOffload = isDC && DC_ACTION_STATUSES.includes(container.status)
  const dnDoc = documents.find(d => d.doc_type === 'DN')

  function openExpand(mode: 'assign' | 'issue') {
    setExpandMode(mode)
    setExpanded(true)
  }

  function closeExpand() {
    setExpanded(false)
    setExpandMode(null)
  }

  return (
    <div className="border-b dark:border-gray-700 last:border-0">
      {/* Main row */}
      <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1.2fr_1.2fr_1.2fr_1.2fr_auto] gap-3 px-4 py-3 text-sm items-center hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors min-w-[1000px]">
        <span className="font-medium text-gray-900 dark:text-gray-100">{container.container_number}</span>
        <span className="text-gray-700 dark:text-gray-300 truncate">{truck?.plate_number ?? <span className="text-gray-400 dark:text-gray-500 italic">—</span>}</span>
        <span className="text-gray-700 dark:text-gray-300 truncate">{truck?.driver_name ?? <span className="text-gray-400 dark:text-gray-500 italic">—</span>}</span>
        <span>
          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_BADGE[container.status])}>
            {STATUS_LABEL[container.status] ?? container.status}
          </span>
        </span>
        <span className="text-gray-700 dark:text-gray-300 text-xs truncate">
          {offloadingPointName ?? <span className="text-gray-400 dark:text-gray-500 italic">—</span>}
        </span>
        <span className="text-gray-600 dark:text-gray-400 text-xs">
          {plannedPullOutDate ? formatDate(plannedPullOutDate) : <span className="text-gray-400 dark:text-gray-500 italic">—</span>}
        </span>
        <span className="text-gray-600 dark:text-gray-400 text-xs">
          {container.actual_pull_out_date ? formatDate(container.actual_pull_out_date) : <span className="text-gray-400 dark:text-gray-500 italic">—</span>}
        </span>
        <span className="text-xs">
          {container.offloaded_at ? <span className="text-green-600 dark:text-green-400 font-medium">{formatDate(container.offloaded_at)}</span> : <span className="text-gray-400 dark:text-gray-500 italic">—</span>}
        </span>
        <div className="flex gap-1.5 items-center justify-end shrink-0">
          {needsAssign && (
            <button
              onClick={() => expanded && expandMode === 'assign' ? closeExpand() : openExpand('assign')}
              className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700"
            >
              {expanded && expandMode === 'assign' ? 'Cancel' : 'Assign Truck'}
            </button>
          )}
          {canIssue && (
            <button
              onClick={() => expanded && expandMode === 'issue' ? closeExpand() : openExpand('issue')}
              className="text-xs border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20"
            >
              {expanded && expandMode === 'issue' ? 'Cancel' : 'Report Issue'}
            </button>
          )}
          {isTransport && container.status === 'OFFLOADED' && (
            <button
              onClick={() => action(() => shipmentsApi.markReturned(shipmentId, container.id), 'Container marked returned')}
              disabled={submitting}
              className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Mark Returned
            </button>
          )}
          {canOffload && (
            <button
              onClick={() => action(() => shipmentsApi.markOffloaded(shipmentId, container.id), 'Container marked offloaded')}
              disabled={submitting}
              className="text-xs bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700 disabled:opacity-50"
            >
              Mark Offloaded
            </button>
          )}
          {container.status === 'OFFLOADED' && isDC && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Offloaded</span>
          )}
          {container.status === 'RETURNED' && (
            <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">✓ Returned</span>
          )}
        </div>
      </div>

      {/* Expanded form row */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-gray-50 dark:bg-gray-700/30">
          {expandMode === 'assign' && (
            <AssignTruckForm
              shipmentId={shipmentId}
              containerId={container.id}
              trucks={trucks}
              onAssigned={() => { onUpdated(); closeExpand() }}
              alwaysOpen
            />
          )}
          {expandMode === 'issue' && truck && (
            <ReportIssueForm
              shipmentId={shipmentId}
              container={container}
              truck={truck}
              onUpdated={() => { onUpdated(); closeExpand() }}
              alwaysOpen
            />
          )}
        </div>
      )}
    </div>
  )
}

function ReportIssueForm({ shipmentId, container, truck, onUpdated, alwaysOpen }: {
  shipmentId: string
  container: Container
  truck: Truck
  onUpdated: () => void
  alwaysOpen?: boolean
}) {
  const [show, setShow] = useState(false)
  const [issueType, setIssueType] = useState<'DELAY' | 'BREAKDOWN'>('DELAY')
  const [remark, setRemark] = useState('')
  const [etaDate, setEtaDate] = useState('')
  const [etaTime, setEtaTime] = useState('')
  const [etaConfirmed, setEtaConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)

  const etaIso = etaDate && etaTime ? new Date(`${etaDate}T${etaTime}`).toISOString() : ''

  function reset() {
    setShow(false)
    setRemark('')
    setIssueType('DELAY')
    setEtaDate('')
    setEtaTime('')
    setEtaConfirmed(false)
  }

  async function submit() {
    if (!remark.trim()) { toast.error('Remark is required'); return }
    if (issueType === 'DELAY' && !etaConfirmed) { toast.error('Please confirm the new ETA'); return }
    setSaving(true)
    try {
      if (issueType === 'BREAKDOWN') {
        await shipmentsApi.markBreakdown(shipmentId, container.id, remark)
        toast.success('Breakdown reported')
      } else {
        await shipmentsApi.assignTruck(shipmentId, {
          container_id: container.id,
          truck_id: truck.id,
          expected_arrival_at: etaIso,
        })
        toast.success('Delay reported — ETA updated')
      }
      onUpdated()
      reset()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (!show && !alwaysOpen) {
    return (
      <button
        onClick={() => setShow(true)}
        className="text-xs border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20"
      >
        Report Delay / Issue
      </button>
    )
  }

  return (
    <div className="space-y-3 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Report Issue</p>

      {/* Issue type */}
      <div className="flex gap-2">
        {(['DELAY', 'BREAKDOWN'] as const).map(type => (
          <button
            key={type}
            onClick={() => setIssueType(type)}
            className={clsx(
              'text-xs px-3 py-1.5 rounded border font-medium transition-colors',
              issueType === type
                ? type === 'DELAY'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-red-600 text-white border-red-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            )}
          >
            {type === 'DELAY' ? 'Delay' : 'Breakdown'}
          </button>
        ))}
      </div>

      {/* Remark */}
      <textarea
        value={remark}
        onChange={e => setRemark(e.target.value)}
        placeholder={issueType === 'DELAY' ? 'Reason for delay…' : 'Describe the breakdown / issue…'}
        className="w-full text-xs border dark:border-gray-600 rounded p-2 h-16 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
      />

      {/* New ETA — only for delay */}
      {issueType === 'DELAY' && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400">New ETA to DC</p>
          {!etaConfirmed ? (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={etaDate}
                onChange={e => setEtaDate(e.target.value)}
                className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white"
              />
              <input
                type="time"
                value={etaTime}
                onChange={e => setEtaTime(e.target.value)}
                className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white"
              />
              <button
                onClick={() => { if (etaDate && etaTime) setEtaConfirmed(true) }}
                disabled={!etaDate || !etaTime}
                className="text-xs bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 font-medium px-3 py-1.5 rounded hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-40"
              >
                OK
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle size={13} className="text-green-500 shrink-0" />
              <span className="text-gray-700 dark:text-gray-200 font-medium">New ETA: {formatDateTime(etaIso)}</span>
              <button onClick={() => setEtaConfirmed(false)} className="text-blue-600 dark:text-blue-400 hover:underline">Change</button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          onClick={submit}
          disabled={saving || !remark.trim() || (issueType === 'DELAY' && !etaConfirmed)}
          className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? 'Submitting…' : 'Submit'}
        </button>
        <button onClick={reset} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
      </div>
    </div>
  )
}

