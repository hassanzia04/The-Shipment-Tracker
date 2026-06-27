import { useState, useMemo } from 'react'
import { X, Pause } from 'lucide-react'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import { useQueryClient } from '@tanstack/react-query'
import { ENTITY_LABELS, HOLD_REASON_LABELS, HOLD_REASON_MAP, TEAM_HOLD_PERMISSIONS } from '@/types'
import type { Team, ExternalEntity, HoldReason, ShipmentListItem, TaskStatus } from '@/types'

type TaskTypeKey = 'PERMIT' | 'BAYAN' | 'DO' | 'CCRO'

const TASK_LABELS: Record<TaskTypeKey, string> = {
  PERMIT: 'Permit',
  BAYAN: 'Bayan',
  DO: 'DO',
  CCRO: 'CCRO',
}

const STATUS_FIELD: Record<TaskTypeKey, keyof ShipmentListItem> = {
  PERMIT: 'permit_status',
  BAYAN: 'bayan_status',
  DO: 'do_status',
  CCRO: 'ccro_status',
}

const ASSIGNEE_FIELD: Partial<Record<TaskTypeKey, keyof ShipmentListItem>> = {
  PERMIT: 'permit_assigned_to_id',
  BAYAN: 'bayan_assigned_to_id',
  DO: 'do_assigned_to_id',
}

const TEAM_TASK_TYPES: Record<string, TaskTypeKey[]> = {
  FFD: ['PERMIT', 'BAYAN', 'DO', 'CCRO'],
  PRO: ['PERMIT', 'BAYAN'],
}

function disabledReason(taskType: TaskTypeKey, shipments: ShipmentListItem[], currentUserId?: string): string | null {
  const assigneeField = ASSIGNEE_FIELD[taskType]
  for (const s of shipments) {
    const status = s[STATUS_FIELD[taskType]] as TaskStatus | null
    if (status === null || status === undefined) return 'Not opened on one or more shipments'
    if (status === 'COMPLETED') return 'Completed on one or more shipments'
    if (status === 'ON_HOLD') return 'Already on hold on one or more shipments'
    if (currentUserId && assigneeField) {
      const assignedTo = s[assigneeField] as string | null
      if (assignedTo !== currentUserId) return 'Not assigned to you on one or more shipments'
    }
  }
  return null
}

interface Props {
  selectedIds: string[]
  selectedShipments: ShipmentListItem[]
  userTeam: Team
  currentUserId?: string
  onClose: () => void
  onDone: () => void
}

export function BulkHoldModal({ selectedIds, selectedShipments, userTeam, currentUserId, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const [entity, setEntity] = useState<ExternalEntity | ''>('')
  const [reason, setReason] = useState<HoldReason | ''>('')
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)

  const count = selectedIds.length
  const allowedEntities = TEAM_HOLD_PERMISSIONS[userTeam] ?? []
  const availableReasons = entity ? HOLD_REASON_MAP[entity] ?? [] : []
  const requiresRemark = entity === 'OTHER' || reason === 'OTHER'

  const taskTypes = TEAM_TASK_TYPES[userTeam] ?? []

  // Per-task eligibility: null means eligible, string means disabled with that reason
  const eligibility = useMemo(() =>
    Object.fromEntries(
      taskTypes.map(t => [t, disabledReason(t, selectedShipments, currentUserId)])
    ) as Record<TaskTypeKey, string | null>,
    [selectedShipments, taskTypes, currentUserId]
  )

  // Only one task type can be selected at a time to ensure intentional, auditable holds
  const [selectedType, setSelectedType] = useState<TaskTypeKey | null>(null)

  const selectedTaskTypes = selectedType ? [selectedType] : []
  const canSubmit = !!entity && !!reason && selectedType !== null && (!requiresRemark || remark.trim())

  function handleEntityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setEntity(e.target.value as ExternalEntity)
    setReason('')
  }

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      await shipmentsApi.bulkAssignHold(selectedIds, entity as string, reason as string, remark.trim() || null, selectedTaskTypes)
      qc.invalidateQueries({ queryKey: ['shipments'] })
      toast.success(`Hold assigned for ${count} shipment${count !== 1 ? 's' : ''}`)
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign hold')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Pause size={15} className="text-amber-600" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Put Tasks on Hold</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Applying hold across{' '}
            <span className="font-semibold text-blue-600">{count}</span> selected shipment{count !== 1 ? 's' : ''}.
          </p>

          {/* Task type selector — radio: only one type per hold action */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Apply to task</p>
            <div className="space-y-1.5">
              {taskTypes.map(t => {
                const disableReason = eligibility[t]
                const disabled = disableReason !== null
                return (
                  <label
                    key={t}
                    className={`flex items-start gap-2.5 rounded-lg px-3 py-2 border transition-colors ${
                      disabled
                        ? 'border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed'
                        : 'border-gray-200 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="hold-task-type"
                      checked={selectedType === t}
                      disabled={disabled}
                      onChange={() => setSelectedType(t)}
                      className="mt-0.5 w-4 h-4 border-gray-300 text-amber-600 focus:ring-amber-500 disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{TASK_LABELS[t]}</span>
                      {disabled && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{disableReason}</p>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Held by entity</label>
            <select
              value={entity}
              onChange={handleEntityChange}
              className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Select entity…</option>
              {allowedEntities.map(e => (
                <option key={e} value={e}>{ENTITY_LABELS[e]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Reason</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as HoldReason)}
              disabled={!entity}
              className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
            >
              <option value="">Select reason…</option>
              {availableReasons.map(r => (
                <option key={r} value={r}>{HOLD_REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Remark {requiresRemark ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional)</span>}
            </label>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="Additional details…"
              rows={2}
              className="w-full text-xs border dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t dark:border-gray-700">
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || saving}
            className="flex items-center gap-1.5 text-xs bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium"
          >
            {saving ? 'Holding…' : 'Put on Hold'}
          </button>
        </div>
      </div>
    </div>
  )
}
