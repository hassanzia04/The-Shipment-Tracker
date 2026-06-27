import { useState } from 'react'
import { X, UserCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import { useQueryClient } from '@tanstack/react-query'

interface Props {
  taskType: 'BAYAN' | 'PERMIT'
  selectedIds: string[]
  proUsers: { id: string; full_name: string }[]
  onClose: () => void
  onDone: () => void
}

export function BulkAssignTaskModal({ taskType, selectedIds, proUsers, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const [assigneeId, setAssigneeId] = useState('')
  const [saving, setSaving] = useState(false)

  const label = taskType === 'BAYAN' ? 'Bayan' : 'Permit'
  const count = selectedIds.length

  async function submit() {
    if (!assigneeId) { toast.error('Select a PRO member'); return }
    setSaving(true)
    try {
      await shipmentsApi.bulkAssignTask(selectedIds, taskType, assigneeId)
      qc.invalidateQueries({ queryKey: ['shipments'] })
      toast.success(`${label} tasks assigned for ${count} shipment${count !== 1 ? 's' : ''}`)
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign tasks')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <UserCheck size={15} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Assign {label} Tasks
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Assigning <span className="font-semibold text-gray-800 dark:text-gray-200">{label}</span> task
            to one PRO member across{' '}
            <span className="font-semibold text-blue-600">{count}</span> selected shipment{count !== 1 ? 's' : ''}.
            Shipments without an open {label} task will be skipped.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Assign to</label>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select PRO member…</option>
              {proUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
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
            disabled={!assigneeId || saving}
            className="flex items-center gap-1.5 text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {saving ? 'Assigning…' : `Assign ${label}`}
          </button>
        </div>
      </div>
    </div>
  )
}
