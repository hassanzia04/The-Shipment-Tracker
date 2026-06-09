import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'
import { shipmentsApi } from '@/api/shipments'
import { documentsApi } from '@/api/documents'
import { mastersApi } from '@/api/masters'
import { useSortable } from '@/lib/sort'
import { SortableHeader } from '@/components/SortableHeader'

import { formatDate, formatDateTime } from '@/lib/dates'
import type { ContainerViewItem, Truck, OutsourcedTruck } from '@/types'
import {
  AlertTriangle, CheckCircle, Clock, Download, Truck as TruckIcon,
  Package, MapPin, Upload, Trash2, Eye, Search, FileSpreadsheet, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

interface Props {
  team: string   // any non-PRO team; action buttons guard themselves to TRANSPORT/DC
}

// ── DO validity urgency ───────────────────────────────────────────────────────
function doUrgency(dateStr: string | null) {
  if (!dateStr) return { label: '—', color: 'text-gray-400' }
  const d = parseISO(dateStr)
  if (!isValid(d)) return { label: '—', color: 'text-gray-400' }
  const days = differenceInCalendarDays(d, new Date())
  const label = formatDate(dateStr)
  if (days < 0)  return { label, color: 'text-red-600 dark:text-red-400 font-semibold' }
  if (days <= 2) return { label, color: 'text-red-500 dark:text-red-400 font-semibold' }
  if (days <= 5) return { label, color: 'text-amber-600 dark:text-amber-400 font-semibold' }
  return              { label, color: 'text-gray-600 dark:text-gray-300' }
}

const STATUS_BADGE: Record<string, string> = {
  PENDING:               'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ASSIGNED:              'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  IN_TRANSIT:            'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  BREAKDOWN:             'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  AT_DC:                 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  OFFLOADED:             'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  RETURNED:              'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  CCRO_RETURNED:         'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  CLOSED:                'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  DO_REVALIDATION:       'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  OUTSOURCED_TRANSPORT:  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
}
const STATUS_LABEL: Record<string, string> = {
  PENDING:               'Transport Allocating Trucks',
  ASSIGNED:              'Trucks Assigned',
  IN_TRANSIT:            'In Transit',
  BREAKDOWN:             'Breakdown',
  AT_DC:                 'Reported to DC',
  OFFLOADED:             'Offloaded',
  RETURNED:              'Returned',
  CCRO_RETURNED:         'CCRO Returned to FFD',
  CLOSED:                'Closed',
  DO_REVALIDATION:       'Pending DO Revalidation',
  OUTSOURCED_TRANSPORT:  'Outsourced Transport',
}

function tomorrowDateStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD
}

// ── Individual row ────────────────────────────────────────────────────────────

function ContainerRow({ c, team, trucks, outsourcedTrucks, onUpdated, historical = false }: {
  c: ContainerViewItem
  team: string
  trucks: Truck[]
  outsourcedTrucks: OutsourcedTruck[]
  onUpdated: () => void
  historical?: boolean
}) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<'assign' | 'issue' | 'arrived' | 'return' | 'revalidation' | 'assign_outsourced' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Assign truck form state
  const [truckId, setTruckId] = useState(c.truck_id ?? '')
  const [etaDate, setEtaDate] = useState(() => tomorrowDateStr())
  const [etaTime, setEtaTime] = useState('09:00')

  // Issue form state
  const [issueType, setIssueType] = useState<'DELAY' | 'BREAKDOWN'>('DELAY')
  const [issueRemark, setIssueRemark] = useState('')
  const [delayEtaDate, setDelayEtaDate] = useState(() => tomorrowDateStr())
  const [delayEtaTime, setDelayEtaTime] = useState('09:00')

  // Arrival time form state
  const [arrivedDate, setArrivedDate] = useState('')
  const [arrivedTime, setArrivedTime] = useState('')

  // Return-to-FFD form state
  const [returnRemark, setReturnRemark] = useState('')

  // DO revalidation request form state
  const [revalidationRemark, setRevalidationRemark] = useState('')

  // Outsourced truck assignment form state
  const [outsourcedTruckId, setOutsourcedTruckId] = useState('')
  const [outsourcedEtaDate, setOutsourcedEtaDate] = useState(() => tomorrowDateStr())
  const [outsourcedEtaTime, setOutsourcedEtaTime] = useState('09:00')

  // DN upload / delete
  const [dnUploading, setDnUploading] = useState(false)
  const [dnDeleting, setDnDeleting] = useState(false)
  const dnInputRef = useRef<HTMLInputElement>(null)

  const isOutsourced = !!c.outsourced_truck_id
  const isAmls = c.offloading_is_amls

  async function handleDnDelete() {
    if (!c.dn_document_id) return
    setDnDeleting(true)
    try {
      await documentsApi.delete(c.dn_document_id)
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
    } catch { toast.error('Delete failed') }
    finally { setDnDeleting(false) }
  }

  const canBreakdownOrDelay = !historical && team === 'TRANSPORT' && !c.arrived_at &&
    ['ASSIGNED', 'IN_TRANSIT', 'BREAKDOWN'].includes(c.status)
  const canAssign       = !historical && team === 'TRANSPORT' && c.status === 'PENDING' && !c.truck_id
  const canReturnToFfd  = !historical && team === 'TRANSPORT' && c.status === 'PENDING' && !c.truck_id
  const canMarkArrived  = !historical && team === 'DC' && !c.arrived_at && (!!c.truck_id || isOutsourced) && isAmls
  const canEditArrived  = !historical && team === 'DC' && !!c.arrived_at && isAmls

  // 3-way offloading logic — AMLS checked first (overrides truck type)
  const canMarkOffloaded = !historical && (() => {
    if (isAmls) return team === 'DC' && c.status === 'AT_DC'
    if (isOutsourced) return team === 'FFD' && c.status === 'OUTSOURCED_TRANSPORT'
    return (team === 'FFD' || team === 'TRANSPORT') && ['ASSIGNED', 'IN_TRANSIT', 'AT_DC', 'BREAKDOWN'].includes(c.status)
  })()

  const canMarkReturned           = !historical && c.status === 'OFFLOADED' && (isOutsourced ? team === 'FFD' : team === 'TRANSPORT')
  const canRequestDoRevalidation  = !historical && team === 'TRANSPORT' && c.status === 'OFFLOADED' && !isOutsourced
  const canMarkDoRevalidated      = !historical && team === 'FFD' && c.status === 'DO_REVALIDATION'
  const canAssignOutsourcedTruck  = !historical && team === 'FFD' && c.status === 'CCRO_RETURNED'

  function openArrivedForm() {
    const d = c.arrived_at ? new Date(c.arrived_at) : new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    setArrivedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    setArrivedTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
    setExpanded('arrived')
  }

  async function downloadCcro() {
    if (!c.ccro_document_id) { toast.error('No CCRO uploaded for this container'); return }
    try {
      const { data } = await documentsApi.getDownloadUrl(c.ccro_document_id)
      const a = document.createElement('a'); a.href = data.url; a.target = '_blank'; a.click()
    } catch { toast.error('Failed to download CCRO') }
  }

  async function assignTruck() {
    if (!truckId || !etaDate || !etaTime) { toast.error('Select a truck and set the ETA'); return }
    setSubmitting(true)
    try {
      const etaIso = new Date(`${etaDate}T${etaTime}`).toISOString()
      await shipmentsApi.assignTruck(c.shipment_id, {
        container_id: c.container_id,
        truck_id: truckId,
        expected_arrival_at: etaIso,
        offloading_point_id: c.offloading_point_id ?? undefined,
      })
      toast.success('Truck assigned')
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
      setExpanded(null)
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function reportIssue() {
    if (!issueRemark.trim()) { toast.error('Remark is required'); return }
    if (issueType === 'DELAY' && (!delayEtaDate || !delayEtaTime)) { toast.error('New ETA is required for delay'); return }
    setSubmitting(true)
    try {
      if (issueType === 'BREAKDOWN') {
        await shipmentsApi.markBreakdown(c.shipment_id, c.container_id, issueRemark)
        toast.success('Breakdown reported')
      } else {
        const etaIso = new Date(`${delayEtaDate}T${delayEtaTime}`).toISOString()
        await shipmentsApi.assignTruck(c.shipment_id, {
          container_id: c.container_id,
          truck_id: c.truck_id!,
          expected_arrival_at: etaIso,
        })
        toast.success('Delay reported — ETA updated')
      }
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
      setExpanded(null)
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function returnToFfd() {
    if (!returnRemark.trim()) { toast.error('Remark is required'); return }
    setSubmitting(true)
    try {
      await shipmentsApi.returnContainerToFfd(c.shipment_id, c.container_id, returnRemark)
      toast.success(`${c.container_number} returned to FFD`)
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
      setExpanded(null)
      setReturnRemark('')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function markArrived() {
    if (!arrivedDate || !arrivedTime) return
    setSubmitting(true)
    try {
      const arrivedAt = new Date(`${arrivedDate}T${arrivedTime}`).toISOString()
      await shipmentsApi.markArrived(c.shipment_id, c.container_id, arrivedAt)
      toast.success(c.arrived_at ? 'Arrival time updated' : `${c.container_number} marked as arrived`)
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
      setExpanded(null)
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function markOffloaded() {
    setSubmitting(true)
    try {
      await shipmentsApi.markOffloaded(c.shipment_id, c.container_id)
      toast.success('Container offloaded')
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function markReturned() {
    setSubmitting(true)
    try {
      await shipmentsApi.markReturned(c.shipment_id, c.container_id)
      toast.success('Container returned')
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function requestDoRevalidation() {
    if (!revalidationRemark.trim()) { toast.error('Remark is required'); return }
    setSubmitting(true)
    try {
      await shipmentsApi.requestDoRevalidation(c.shipment_id, c.container_id, revalidationRemark)
      toast.success('DO revalidation requested')
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
      setExpanded(null)
      setRevalidationRemark('')
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function markDoRevalidated() {
    setSubmitting(true)
    try {
      await shipmentsApi.markDoRevalidated(c.shipment_id, c.container_id)
      toast.success('Container marked as revalidated')
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function assignOutsourcedTruck() {
    if (!outsourcedTruckId || !outsourcedEtaDate || !outsourcedEtaTime) { toast.error('Select a truck and set the ETA'); return }
    setSubmitting(true)
    try {
      const etaIso = new Date(`${outsourcedEtaDate}T${outsourcedEtaTime}`).toISOString()
      await shipmentsApi.assignOutsourcedTruck(c.shipment_id, c.container_id, {
        outsourced_truck_id: outsourcedTruckId,
        expected_arrival_at: etaIso,
      })
      toast.success('Outsourced truck assigned')
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
      setExpanded(null)
    } catch (e: any) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSubmitting(false) }
  }

  async function handleDnUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setDnUploading(true)
    try {
      await documentsApi.upload({ shipment_id: c.shipment_id, container_id: c.container_id, doc_type: 'DN', file })
      toast.success('Delivery Note uploaded')
      qc.invalidateQueries({ queryKey: ['container-view'] })
      onUpdated()
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Upload failed') }
    finally { setDnUploading(false); if (dnInputRef.current) dnInputRef.current.value = '' }
  }

  const validity = doUrgency(c.do_validity_date)

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
        {/* B/L */}
        <td className="px-3 py-3">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.bl_number}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {c.container_count ? `${c.container_count} containers on B/L` : ''}
          </p>
          {historical && c.shipment_stage && (
            <span className="mt-1 inline-block text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
              {c.shipment_stage.replace(/_/g, ' ')}
            </span>
          )}
        </td>
        {/* Container # */}
        <td className="px-3 py-3">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.container_number}</p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', STATUS_BADGE[c.status])}>
              {STATUS_LABEL[c.status] ?? c.status}
            </span>
            {c.was_requeued && c.status === 'PENDING' && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                Re-queued
              </span>
            )}
          </div>
          {c.status === 'DO_REVALIDATION' && c.revalidation_remark && (
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1 italic">{c.revalidation_remark}</p>
          )}
        </td>
        {/* DO Validity */}
        <td className={clsx('px-3 py-3 text-sm', validity.color)}>{validity.label}</td>
        {/* Truck / Driver */}
        <td className="px-3 py-3 text-sm">
          {isOutsourced && c.outsourced_plate_number ? (
            <>
              <p className="font-medium text-cyan-700 dark:text-cyan-300">{c.outsourced_plate_number}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{c.outsourced_driver_name}</p>
              <span className="text-xs text-cyan-600 dark:text-cyan-500">Outsourced</span>
            </>
          ) : c.plate_number ? (
            <>
              <p className="font-medium text-gray-800 dark:text-gray-100">{c.plate_number}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{c.driver_name}</p>
            </>
          ) : (
            <span className="text-gray-400 dark:text-gray-500 italic text-xs">Unassigned</span>
          )}
        </td>
        {/* Offloading Location */}
        <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-300">
          {c.offloading_point_name ?? <span className="text-gray-400 italic text-xs">—</span>}
        </td>
        {/* ETA / Arrived */}
        <td className="px-3 py-3 text-sm">
          {c.arrived_at ? (
            <div className="text-green-600 dark:text-green-400 text-xs font-medium">
              <span className="flex items-center gap-1"><CheckCircle size={12} /> Arrived</span>
              <span className="text-gray-500 dark:text-gray-400 font-normal">{formatDateTime(c.arrived_at)}</span>
            </div>
          ) : (c.expected_arrival_at ?? c.outsourced_expected_arrival_at) ? (
            <span className="text-gray-600 dark:text-gray-300 text-xs">{formatDateTime((c.expected_arrival_at ?? c.outsourced_expected_arrival_at)!)}</span>
          ) : (
            <span className="text-gray-400 text-xs italic">Not set</span>
          )}
        </td>
        {/* Offloading Date */}
        <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-300">
          {c.offloaded_at
            ? <span className="text-green-600 dark:text-green-400 text-xs">{formatDateTime(c.offloaded_at)}</span>
            : <span className="text-gray-400 text-xs italic">—</span>
          }
        </td>
        {/* Actions */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* CCRO Download — not shown to DC */}
            {c.ccro_document_id && team !== 'DC' && (
              <button onClick={downloadCcro} className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Download CCRO">
                <Download size={11} /> CCRO
              </button>
            )}
            {/* Transport actions */}
            {canAssign && (
              <button
                onClick={() => setExpanded(expanded === 'assign' ? null : 'assign')}
                className={clsx('flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium', expanded === 'assign' ? 'bg-blue-600 text-white border-blue-600' : 'text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20')}
              >
                <TruckIcon size={11} /> Assign
              </button>
            )}
            {canReturnToFfd && (
              <button
                onClick={() => setExpanded(expanded === 'return' ? null : 'return')}
                className={clsx('flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium', expanded === 'return' ? 'bg-orange-600 text-white border-orange-600' : 'text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20')}
              >
                <AlertTriangle size={11} /> Return to FFD
              </button>
            )}
            {canBreakdownOrDelay && (
              <button
                onClick={() => setExpanded(expanded === 'issue' ? null : 'issue')}
                className={clsx('flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium', expanded === 'issue' ? 'bg-amber-500 text-white border-amber-500' : 'text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20')}
              >
                <AlertTriangle size={11} /> Issue
              </button>
            )}
            {canMarkReturned && (
              <button onClick={markReturned} disabled={submitting} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50">
                Mark Returned
              </button>
            )}
            {canRequestDoRevalidation && (
              <button
                onClick={() => setExpanded(expanded === 'revalidation' ? null : 'revalidation')}
                className={clsx('flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium', expanded === 'revalidation' ? 'bg-rose-600 text-white border-rose-600' : 'text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20')}
              >
                <AlertTriangle size={11} /> Request Revalidation
              </button>
            )}
            {canMarkDoRevalidated && (
              <button onClick={markDoRevalidated} disabled={submitting} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                Mark Revalidated
              </button>
            )}
            {canAssignOutsourcedTruck && (
              <button
                onClick={() => setExpanded(expanded === 'assign_outsourced' ? null : 'assign_outsourced')}
                className={clsx('flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium', expanded === 'assign_outsourced' ? 'bg-cyan-600 text-white border-cyan-600' : 'text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-700 hover:bg-cyan-50 dark:hover:bg-cyan-900/20')}
              >
                <TruckIcon size={11} /> Assign Outsourced Truck
              </button>
            )}
            {/* DC actions */}
            {canMarkArrived && (
              <button
                onClick={() => expanded === 'arrived' ? setExpanded(null) : openArrivedForm()}
                className={clsx('flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium',
                  expanded === 'arrived'
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                )}
              >
                <MapPin size={11} /> Arrived
              </button>
            )}
            {canEditArrived && (
              <button
                onClick={() => expanded === 'arrived' ? setExpanded(null) : openArrivedForm()}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline"
              >
                Edit time
              </button>
            )}
            {/* AMLS offload: DN required (regardless of truck type — DC only) */}
            {canMarkOffloaded && isAmls && !c.dn_document_id && (
              <>
                <input ref={dnInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleDnUpload} />
                <button
                  onClick={() => dnInputRef.current?.click()}
                  disabled={dnUploading}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                >
                  <Upload size={11} /> {dnUploading ? 'Uploading…' : 'Upload DN'}
                </button>
                <button disabled className="text-xs bg-green-600 text-white px-2 py-1 rounded opacity-40 cursor-not-allowed" title="Upload Delivery Note first">
                  Offloaded
                </button>
              </>
            )}
            {canMarkOffloaded && isAmls && c.dn_document_id && (
              <>
                <button
                  onClick={async () => { const { data } = await documentsApi.getUrl(c.dn_document_id!); window.open(data.url, '_blank') }}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  title="View Delivery Note"
                >
                  <Eye size={11} /> DN
                </button>
                <button
                  onClick={handleDnDelete}
                  disabled={dnDeleting}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium text-red-600 dark:text-red-400 border-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                  title="Delete Delivery Note"
                >
                  <Trash2 size={11} />
                </button>
                <button onClick={markOffloaded} disabled={submitting} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                  Offloaded
                </button>
              </>
            )}
            {/* Non-AMLS: offload directly, no DN required */}
            {canMarkOffloaded && !isAmls && (
              <button onClick={markOffloaded} disabled={submitting} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                Offloaded
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* ── Assign truck form ── */}
      {expanded === 'assign' && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="px-5 py-3 bg-blue-50 dark:bg-blue-900/10 border-t border-b dark:border-gray-700 space-y-3">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Assign Truck & Driver</p>
              <div className="flex flex-wrap gap-3">
                <select value={truckId} onChange={e => setTruckId(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-w-[200px]">
                  <option value="">Select truck…</option>
                  {trucks.filter(t => t.is_active).map(t => (
                    <option key={t.id} value={t.id}>{t.plate_number} — {t.driver_name} ({t.contractor})</option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">ETA:</span>
                  <input type="date" value={etaDate} onChange={e => setEtaDate(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                  <input type="time" value={etaTime} onChange={e => setEtaTime(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                </div>
                <button onClick={assignTruck} disabled={submitting || !truckId || !etaDate || !etaTime} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
                  {submitting ? 'Saving…' : 'Assign'}
                </button>
                <button onClick={() => setExpanded(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── Return to FFD form ── */}
      {expanded === 'return' && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="px-5 py-3 bg-orange-50 dark:bg-orange-900/10 border-t border-b dark:border-gray-700 space-y-2">
              <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Return CCRO to FFD</p>
              <p className="text-xs text-orange-600 dark:text-orange-500">Explain why a truck could not be assigned for this container.</p>
              <div className="flex gap-2 items-start">
                <textarea
                  value={returnRemark}
                  onChange={e => setReturnRemark(e.target.value)}
                  placeholder="e.g. No trucks of required size available…"
                  className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 resize-none h-14 flex-1"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={returnToFfd} disabled={submitting || !returnRemark.trim()} className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700 disabled:opacity-50">
                  {submitting ? 'Sending…' : 'Return to FFD'}
                </button>
                <button onClick={() => setExpanded(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── Arrival time form ── */}
      {expanded === 'arrived' && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="px-5 py-3 bg-purple-50 dark:bg-purple-900/10 border-t border-b dark:border-gray-700 space-y-2">
              <p className="text-xs font-semibold text-purple-700 dark:text-purple-400">
                {c.arrived_at ? 'Edit Arrival Time' : 'Record Arrival Time'}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <input type="date" value={arrivedDate} onChange={e => setArrivedDate(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                <input type="time" value={arrivedTime} onChange={e => setArrivedTime(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                <button
                  onClick={markArrived}
                  disabled={submitting || !arrivedDate || !arrivedTime}
                  className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : c.arrived_at ? 'Update' : 'Confirm Arrival'}
                </button>
                <button onClick={() => setExpanded(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Defaults to current time — adjust if logging retroactively</p>
            </div>
          </td>
        </tr>
      )}

      {/* ── DO revalidation request form ── */}
      {expanded === 'revalidation' && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="px-5 py-3 bg-rose-50 dark:bg-rose-900/10 border-t border-b dark:border-gray-700 space-y-2">
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">Request DO Revalidation</p>
              <p className="text-xs text-rose-600 dark:text-rose-500">Explain why the DO needs to be revalidated before this container can be returned.</p>
              <div className="flex gap-2 items-start">
                <textarea
                  value={revalidationRemark}
                  onChange={e => setRevalidationRemark(e.target.value)}
                  placeholder="e.g. DO expired — container not yet returned…"
                  className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 resize-none h-14 flex-1"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={requestDoRevalidation} disabled={submitting || !revalidationRemark.trim()} className="text-xs bg-rose-600 text-white px-3 py-1.5 rounded hover:bg-rose-700 disabled:opacity-50">
                  {submitting ? 'Sending…' : 'Request Revalidation'}
                </button>
                <button onClick={() => setExpanded(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── Issue (breakdown / delay) form ── */}
      {expanded === 'issue' && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/10 border-t border-b dark:border-gray-700 space-y-3">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Report Issue</p>
              <div className="flex gap-2">
                {(['DELAY', 'BREAKDOWN'] as const).map(t => (
                  <button key={t} onClick={() => setIssueType(t)} className={clsx('text-xs px-3 py-1.5 rounded border font-medium', issueType === t ? (t === 'BREAKDOWN' ? 'bg-red-600 text-white border-red-600' : 'bg-amber-600 text-white border-amber-600') : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700')}>
                    {t === 'DELAY' ? 'Delay' : 'Breakdown'}
                  </button>
                ))}
              </div>
              <textarea value={issueRemark} onChange={e => setIssueRemark(e.target.value)} placeholder={issueType === 'DELAY' ? 'Reason for delay…' : 'Describe the breakdown…'} className="w-full text-xs border dark:border-gray-600 rounded p-2 h-14 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
              {issueType === 'DELAY' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">New ETA:</span>
                  <input type="date" value={delayEtaDate} onChange={e => setDelayEtaDate(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                  <input type="time" value={delayEtaTime} onChange={e => setDelayEtaTime(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={reportIssue} disabled={submitting} className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50">{submitting ? 'Saving…' : 'Submit'}</button>
                <button onClick={() => setExpanded(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── Assign outsourced truck form ── */}
      {expanded === 'assign_outsourced' && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="px-5 py-3 bg-cyan-50 dark:bg-cyan-900/10 border-t border-b dark:border-gray-700 space-y-3">
              <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-400">Assign Outsourced Truck (Non-AMLS)</p>
              <div className="flex flex-wrap gap-3">
                <select value={outsourcedTruckId} onChange={e => setOutsourcedTruckId(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-w-[220px]">
                  <option value="">Select outsourced truck…</option>
                  {outsourcedTrucks.filter(t => t.is_active).map(t => (
                    <option key={t.id} value={t.id}>{t.plate_number} — {t.driver_name} ({t.contractor})</option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">ETA:</span>
                  <input type="date" value={outsourcedEtaDate} onChange={e => setOutsourcedEtaDate(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                  <input type="time" value={outsourcedEtaTime} onChange={e => setOutsourcedEtaTime(e.target.value)} className="text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white" />
                </div>
                <button onClick={assignOutsourcedTruck} disabled={submitting || !outsourcedTruckId} className="text-xs bg-cyan-600 text-white px-3 py-1.5 rounded hover:bg-cyan-700 disabled:opacity-50">
                  {submitting ? 'Saving…' : 'Assign'}
                </button>
                <button onClick={() => setExpanded(null)} className="text-xs text-gray-500 dark:text-gray-400">Cancel</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContainerView({ team }: Props) {
  const qc = useQueryClient()
  const [downloadingCcros, setDownloadingCcros] = useState(false)
  const [historical, setHistorical] = useState(false)
  const [amlsOnly, setAmlsOnly] = useState(team === 'DC')
  const [search, setSearch] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [exporting, setExporting] = useState(false)

  const { data: containers = [], isLoading, refetch } = useQuery({
    queryKey: ['container-view', historical],
    queryFn: () => shipmentsApi.containerView(historical).then(r => r.data),
    refetchInterval: historical ? false : 2 * 60_000,
  })

  const { data: trucks = [] } = useQuery<Truck[]>({
    queryKey: ['trucks'],
    queryFn: () => mastersApi.trucks.list().then(r => r.data),
    enabled: team === 'TRANSPORT',
  })

  const { data: outsourcedTrucks = [] } = useQuery<OutsourcedTruck[]>({
    queryKey: ['outsourcedTrucks'],
    queryFn: () => mastersApi.outsourcedTrucks.list().then(r => r.data),
    enabled: team === 'FFD',
  })

  const { sorted: sortedContainers, sort: contSort, toggle: contToggle } = useSortable(containers, (c, col) => {
    switch (col) {
      case 'bl':        return c.bl_number
      case 'container': return c.container_number
      case 'do':        return c.do_validity_date
      case 'truck':     return c.plate_number
      case 'location':  return c.offloading_point_name
      case 'eta':       return c.arrived_at ?? c.expected_arrival_at ?? c.outsourced_expected_arrival_at
      default:          return null
    }
  })

  // Pending counts — exclude CCRO_RETURNED containers from assignment queue
  const pendingAssign      = containers.filter(c => c.status === 'PENDING' && !c.truck_id).length
  const pendingOffload     = containers.filter(c => c.arrived_at && c.status !== 'OFFLOADED' && c.status !== 'RETURNED' && (team !== 'DC' || c.offloading_is_amls)).length
  const pendingArrival     = containers.filter(c => !c.arrived_at && c.truck_id && (team !== 'DC' || c.offloading_is_amls)).length
  const pendingCcrosCount     = containers.filter(c => c.status === 'PENDING' && !c.truck_id && c.ccro_document_id).length
  const ccroReturnedCount     = containers.filter(c => c.status === 'CCRO_RETURNED').length
  const doRevalidationCount   = containers.filter(c => c.status === 'DO_REVALIDATION').length

  async function downloadAllCcros() {
    setDownloadingCcros(true)
    try {
      const { data } = await documentsApi.downloadPendingCcrosZip()
      const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'Pending_CCROs.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download CCROs')
    } finally {
      setDownloadingCcros(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { data } = await shipmentsApi.containerViewExport({
        search: search || undefined,
        from_date: filterFrom || undefined,
        to_date: filterTo || undefined,
        status: statusFilter || undefined,
        historical,
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `containers_${historical ? 'history' : 'active'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to export')
    } finally {
      setExporting(false)
    }
  }

  const filteredContainers = sortedContainers.filter(c => {
    if (amlsOnly && team === 'DC' && !c.offloading_is_amls) return false
    if (search) {
      const term = search.toLowerCase()
      if (!c.container_number.toLowerCase().includes(term) && !c.bl_number.toLowerCase().includes(term)) return false
    }
    if (statusFilter && c.status !== statusFilter) return false
    if (filterFrom && (!c.offloaded_at || c.offloaded_at < filterFrom)) return false
    if (filterTo && (!c.offloaded_at || c.offloaded_at.slice(0, 10) > filterTo)) return false
    return true
  })

  if (isLoading) {
    return <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />)}</div>
  }

  return (
    <div className="space-y-4">
      {/* Header row: summary chips + Active/History toggle */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-3">
          {!historical && team === 'TRANSPORT' && pendingAssign > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
              <AlertTriangle size={15} className="text-amber-500 shrink-0" />
              <span className="font-medium text-amber-800 dark:text-amber-300">
                {pendingAssign} container{pendingAssign !== 1 ? 's' : ''} pending truck assignment
              </span>
            </div>
          )}
          {!historical && team === 'TRANSPORT' && ccroReturnedCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-sm">
              <AlertTriangle size={15} className="text-orange-500 shrink-0" />
              <span className="font-medium text-orange-800 dark:text-orange-300">
                {ccroReturnedCount} container{ccroReturnedCount !== 1 ? 's' : ''} returned to FFD — awaiting resolution
              </span>
            </div>
          )}
          {!historical && team === 'FFD' && doRevalidationCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm">
              <AlertTriangle size={15} className="text-rose-500 shrink-0" />
              <span className="font-medium text-rose-800 dark:text-rose-300">
                {doRevalidationCount} container{doRevalidationCount !== 1 ? 's' : ''} pending DO revalidation
              </span>
            </div>
          )}
          {!historical && team === 'FFD' && ccroReturnedCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-sm">
              <AlertTriangle size={15} className="text-orange-500 shrink-0" />
              <span className="font-medium text-orange-800 dark:text-orange-300">
                {ccroReturnedCount} container{ccroReturnedCount !== 1 ? 's' : ''} returned to FFD — action required
              </span>
            </div>
          )}
          {!historical && team === 'TRANSPORT' && pendingCcrosCount > 0 && (
            <button
              onClick={downloadAllCcros}
              disabled={downloadingCcros}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-50 transition-colors"
            >
              <Download size={15} className="shrink-0" />
              {downloadingCcros ? 'Downloading…' : `Download All CCROs (${pendingCcrosCount})`}
            </button>
          )}
          {!historical && team === 'DC' && pendingArrival > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
              <Clock size={15} className="text-blue-500 shrink-0" />
              <span className="font-medium text-blue-800 dark:text-blue-300">
                {pendingArrival} container{pendingArrival !== 1 ? 's' : ''} en route — pending arrival confirmation
              </span>
            </div>
          )}
          {!historical && team === 'DC' && pendingOffload > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-sm">
              <Package size={15} className="text-purple-500 shrink-0" />
              <span className="font-medium text-purple-800 dark:text-purple-300">
                {pendingOffload} container{pendingOffload !== 1 ? 's' : ''} at DC — pending offloading
              </span>
            </div>
          )}
          {containers.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {historical ? 'No historical containers found.' : 'No active containers in your queue.'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* AMLS-only toggle — visible to DC */}
          {team === 'DC' && (
            <div className="flex border dark:border-gray-600 rounded-lg overflow-hidden">
              <button
                onClick={() => setAmlsOnly(true)}
                className={clsx('px-3 py-2 text-sm transition-colors', amlsOnly ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
              >
                AMLS Only
              </button>
              <button
                onClick={() => setAmlsOnly(false)}
                className={clsx('px-3 py-2 text-sm transition-colors', !amlsOnly ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
              >
                All
              </button>
            </div>
          )}
          {/* Active / History toggle */}
          <div className="flex border dark:border-gray-600 rounded-lg overflow-hidden">
            <button
              onClick={() => setHistorical(false)}
              className={clsx('px-3 py-2 text-sm transition-colors', !historical ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
            >
              Active
            </button>
            <button
              onClick={() => setHistorical(true)}
              className={clsx('px-3 py-2 text-sm transition-colors', historical ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
            >
              History
            </button>
          </div>
        </div>
      </div>

      {/* Search / filter / export bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search container or B/L…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs border dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span>Offloaded from</span>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 dark:text-white text-xs" />
          <span>to</span>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 dark:text-white text-xs" />
          {(filterFrom || filterTo) && (
            <button onClick={() => { setFilterFrom(''); setFilterTo('') }} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 text-xs border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 whitespace-nowrap"
        >
          <FileSpreadsheet size={13} /> {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>

      {/* Table */}
      {filteredContainers.length === 0 && containers.length > 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500">No containers match the current filters.</p>
      )}
      {filteredContainers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <tr>
                  <SortableHeader label="B/L Number"        column="bl"        sort={contSort} onSort={contToggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Container"          column="container" sort={contSort} onSort={contToggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="DO Validity"        column="do"        sort={contSort} onSort={contToggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Truck / Driver"     column="truck"     sort={contSort} onSort={contToggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="Offloading Location" column="location" sort={contSort} onSort={contToggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <SortableHeader label="ETA / Arrived"      column="eta"       sort={contSort} onSort={contToggle} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
                  <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">Offloading Date</th>
                  <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {filteredContainers.map(c => (
                  <ContainerRow
                    key={c.container_id}
                    c={c}
                    team={team}
                    trucks={trucks as Truck[]}
                    outsourcedTrucks={outsourcedTrucks as OutsourcedTruck[]}
                    onUpdated={refetch}
                    historical={historical}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
