import { useState } from 'react'
import { AlertTriangle, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import { ENTITY_LABELS, HOLD_REASON_LABELS, HOLD_REASON_MAP, TEAM_HOLD_PERMISSIONS } from '@/types'
import type { Task, ExternalEntity, HoldReason, Team } from '@/types'
import clsx from 'clsx'

interface Props {
  shipmentId: string
  task: Task
  userTeam: Team
  onUpdated: () => void
}

export function HoldPanel({ shipmentId, task, userTeam, onUpdated }: Props) {
  const [showAssign, setShowAssign] = useState(false)
  const [showRelease, setShowRelease] = useState(false)
  const [entity, setEntity] = useState<ExternalEntity | ''>('')
  const [reason, setReason] = useState<HoldReason | ''>('')
  const [remark, setRemark] = useState('')
  const [releaseRemark, setReleaseRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const allowedEntities = TEAM_HOLD_PERMISSIONS[userTeam] || []
  const isOnHold = task.status === 'ON_HOLD'

  const remarkRequired = (userTeam !== 'PRO' && userTeam !== 'FFD') || entity === 'OTHER' || reason === 'OTHER'

  async function handleAssignHold() {
    if (!entity || !reason || (remarkRequired && !remark.trim())) { toast.error('Entity, reason and remark are required'); return }
    setSubmitting(true)
    try {
      await shipmentsApi.assignHold(shipmentId, task.id, { hold_entity: entity, hold_reason: reason, hold_remark: remark })
      toast.success('Hold assigned')
      setShowAssign(false)
      setEntity(''); setReason(''); setRemark('')
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign hold')
    } finally {
      setSubmitting(false)
    }
  }

  const releaseRemarkRequired = userTeam !== 'PRO' && userTeam !== 'FFD'

  async function handleReleaseHold() {
    if (releaseRemarkRequired && !releaseRemark.trim()) { toast.error('Resolution remark is required'); return }
    setSubmitting(true)
    try {
      await shipmentsApi.releaseHold(shipmentId, task.id, releaseRemark)
      toast.success('Hold released')
      setShowRelease(false)
      setReleaseRemark('')
      onUpdated()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to release hold')
    } finally {
      setSubmitting(false)
    }
  }

  if (isOnHold) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          <span className="text-sm font-medium text-amber-800">
            On hold with {task.hold_entity ? ENTITY_LABELS[task.hold_entity] : '—'}
          </span>
        </div>
        {task.hold_reason && <p className="text-xs text-amber-700">{HOLD_REASON_LABELS[task.hold_reason]}</p>}
        {task.hold_remark && <p className="text-xs text-gray-600 italic">"{task.hold_remark}"</p>}

        {!showRelease ? (
          <button onClick={() => setShowRelease(true)} className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700">
            <Unlock size={12} /> Release Hold
          </button>
        ) : (
          <div className="space-y-2">
            <textarea
              value={releaseRemark}
              onChange={e => setReleaseRemark(e.target.value)}
              placeholder={releaseRemarkRequired ? 'Describe how the hold was resolved (required)…' : 'Describe how the hold was resolved (optional)…'}
              className="w-full text-sm border dark:border-gray-600 rounded p-2 h-20 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
            />
            <div className="flex gap-2">
              <button onClick={handleReleaseHold} disabled={submitting} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50">
                {submitting ? 'Saving…' : 'Confirm Release'}
              </button>
              <button onClick={() => setShowRelease(false)} className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!allowedEntities.length) return null

  return (
    <div>
      {!showAssign ? (
        <button onClick={() => setShowAssign(true)} className="flex items-center gap-1 text-xs text-amber-700 border border-amber-300 px-3 py-1.5 rounded hover:bg-amber-50">
          <AlertTriangle size={12} /> Assign Hold
        </button>
      ) : (
        <div className="bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Assign hold to external party</p>
          <select value={entity} onChange={e => { setEntity(e.target.value as ExternalEntity); setReason('') }} className="w-full text-sm border dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-600 text-gray-900 dark:text-white">
            <option value="">Select entity…</option>
            {allowedEntities.map(e => <option key={e} value={e}>{ENTITY_LABELS[e]}</option>)}
          </select>
          {entity && (
            <select value={reason} onChange={e => setReason(e.target.value as HoldReason)} className="w-full text-sm border dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-600 text-gray-900 dark:text-white">
              <option value="">Select reason…</option>
              {HOLD_REASON_MAP[entity as ExternalEntity].map(r => <option key={r} value={r}>{HOLD_REASON_LABELS[r]}</option>)}
            </select>
          )}
          <textarea
            value={remark}
            onChange={e => setRemark(e.target.value)}
            placeholder={
              entity === 'OTHER' || reason === 'OTHER'
                ? 'Describe the issue in detail (required for Other)…'
                : remarkRequired
                ? 'Add remarks (required)…'
                : 'Add remarks (optional)…'
            }
            className="w-full text-sm border dark:border-gray-600 rounded p-2 h-20 resize-none bg-white dark:bg-gray-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
          />
          <div className="flex gap-2">
            <button onClick={handleAssignHold} disabled={submitting} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded hover:bg-amber-600 disabled:opacity-50">
              {submitting ? 'Saving…' : 'Assign Hold'}
            </button>
            <button onClick={() => setShowAssign(false)} className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
