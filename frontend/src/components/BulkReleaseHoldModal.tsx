import { useState, useMemo } from 'react'
import { X, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import { useQueryClient } from '@tanstack/react-query'
import type { Team, ShipmentListItem, TaskStatus } from '@/types'

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
    if (status !== 'ON_HOLD') return 'Not on hold on one or more shipments'
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

export function BulkReleaseHoldModal({ selectedIds, selectedShipments, userTeam, currentUserId, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)

  const count = selectedIds.length
  const taskTypes = TEAM_TASK_TYPES[userTeam] ?? []

  const eligibility = useMemo(() =>
    Object.fromEntries(
      taskTypes.map(t => [t, disabledReason(t, selectedShipments, currentUserId)])
    ) as Record<TaskTypeKey, string | null>,
    [selectedShipments, taskTypes, currentUserId]
  )

  const [selectedType, setSelectedType] = useState<TaskTypeKey | null>(null)

  const selectedTaskTypes = selectedType ? [selectedType] : []

  async function submit() {
    if (!selectedType) { toast.error('Select a task type'); return }
    setSaving(true)
    try {
      await shipmentsApi.bulkReleaseHold(selectedIds, remark.trim() || null, selectedTaskTypes)
      qc.invalidateQueries({ queryKey: ['shipments'] })
      toast.success(`Hold released for ${count} shipment${count !== 1 ? 's' : ''}`)
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to release hold')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Unlock size={15} className="text-green-600" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Release Hold</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Releasing hold across{' '}
            <span className="font-semibold text-blue-600">{count}</span> selected shipment{count !== 1 ? 's' : ''}.
          </p>

          {/* Task type selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Release hold on task</p>
            <div className="space-y-1.5">
              {taskTypes.map(t => {
                const reason = eligibility[t]
                const disabled = reason !== null
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
                      name="release-hold-task-type"
                      checked={selectedType === t}
                      disabled={disabled}
                      onChange={() => setSelectedType(t)}
                      className="mt-0.5 w-4 h-4 border-gray-300 text-green-600 focus:ring-green-500 disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{TASK_LABELS[t]}</span>
                      {disabled && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{reason}</p>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Resolution remark <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="What resolved the hold?…"
              rows={2}
              className="w-full text-xs border dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
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
            disabled={!selectedType || saving}
            className="flex items-center gap-1.5 text-xs bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
          >
            {saving ? 'Releasing…' : 'Release Hold'}
          </button>
        </div>
      </div>
    </div>
  )
}
