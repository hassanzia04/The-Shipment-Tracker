import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { authApi } from '@/api/auth'
import { shipmentsApi } from '@/api/shipments'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/lib/dates'
import { differenceInDays, parseISO } from 'date-fns'
import { User, AlertTriangle, Clock, ChevronDown, UserCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

interface ProTask {
  task_id: string
  task_type: string
  status: string
  hold_entity: string | null
  hold_remark: string | null
  created_at: string
  bl_number: string
  shipment_id: string
  shipment_stage: string
  pull_out_date: string | null
  pro_user_id: string | null
  pro_user_name: string | null
}

const TASK_LABEL: Record<string, string> = {
  PERMIT:        'Permit',
  BAYAN:         'Bayan',
  DO:            'Delivery Order',
  CCRO:          'CCRO',
  CCRO_ROP:      'CCRO / ROP',
  BAYAN_PAYMENT: 'Bayan Payment',
}

const TASK_COLOR: Record<string, string> = {
  PERMIT:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  BAYAN:         'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  DO:            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  CCRO:          'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  CCRO_ROP:      'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  BAYAN_PAYMENT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const STAGE_LABEL: Record<string, string> = {
  CUSTOMER:     'Customer',
  FFD_REVIEW:   'FFD Review',
  IN_PROGRESS:  'In Progress',
  TRANSPORT:    'Transport',
  DC_TRANSPORT: 'DC / Transport',
  COMPLETED:    'Completed',
}

const ENTITY_LABEL: Record<string, string> = {
  SHIPPING_LINE: 'Shipping Line',
  ROP:           'ROP',
  MOAF:          'MOAF',
  PORT:          'Port',
  OTHER:         'Other',
}

function ageDays(created_at: string): number {
  return differenceInDays(new Date(), parseISO(created_at))
}

// Groups start collapsed; only the ones the user opened are remembered
const EXPANDED_STORAGE_KEY = 'pro_tasks_expanded'

export function ProTasks() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const canReassign = user?.team === 'FFD' || !!user?.is_admin
  const [reassigningId, setReassigningId] = useState<string | null>(null)
  const [savingReassign, setSavingReassign] = useState(false)

  const { data: proUsers = [] } = useQuery({
    queryKey: ['team-workload', 'PRO'],
    queryFn: () => authApi.listTeamWorkload('PRO').then(r => r.data),
    enabled: canReassign,
  })

  async function reassign(task: ProTask, assigneeId: string) {
    setSavingReassign(true)
    try {
      await shipmentsApi.assignTask(task.shipment_id, task.task_id, assigneeId)
      toast.success(`${TASK_LABEL[task.task_type] ?? task.task_type} task reassigned — ${task.bl_number}`)
      setReassigningId(null)
      qc.invalidateQueries({ queryKey: ['pro-tasks'] })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to reassign task')
    } finally {
      setSavingReassign(false)
    }
  }

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(EXPANDED_STORAGE_KEY)
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set()
    } catch { return new Set() }
  })

  function toggleGroup(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try { localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  const { data: tasks = [], isLoading } = useQuery<ProTask[]>({
    queryKey: ['pro-tasks'],
    queryFn: () => api.get<ProTask[]>('/analytics/pro-tasks').then(r => r.data),
    refetchInterval: 60_000,
  })

  // Group by pro_user_name (null → "Unassigned")
  const grouped = tasks.reduce<Record<string, ProTask[]>>((acc, t) => {
    const key = t.pro_user_name ?? '__unassigned__'
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    if (a === '__unassigned__') return 1
    if (b === '__unassigned__') return -1
    return a.localeCompare(b)
  })

  const totalOnHold = tasks.filter(t => t.status === 'ON_HOLD').length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">PRO Tasks</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tasks.length} active task{tasks.length !== 1 ? 's' : ''}
          {totalOnHold > 0 && (
            <span className="ml-2 text-amber-600 dark:text-amber-400 font-medium">
              · {totalOnHold} on hold
            </span>
          )}
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400 dark:text-gray-500 text-sm">No active PRO tasks.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedGroups.map(([key, groupTasks]) => {
            const userName = key === '__unassigned__' ? 'Unassigned' : key
            const onHold = groupTasks.filter(t => t.status === 'ON_HOLD').length
            const isCollapsed = !expanded.has(key)
            return (
              <div key={key} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  className={clsx(
                    'w-full px-4 py-3 flex items-center gap-2.5 bg-gray-50 dark:bg-gray-800/60 text-left hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors',
                    !isCollapsed && 'border-b dark:border-gray-700'
                  )}
                >
                  <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <User size={14} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-white text-sm">{userName}</span>
                  <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                    {groupTasks.length} task{groupTasks.length !== 1 ? 's' : ''}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {onHold > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                        <AlertTriangle size={12} />
                        {onHold} on hold
                      </span>
                    )}
                    <ChevronDown
                      size={16}
                      className={clsx(
                        'text-gray-400 dark:text-gray-500 transition-transform',
                        isCollapsed && '-rotate-90'
                      )}
                    />
                  </span>
                </button>

                {/* Task rows */}
                <div className={clsx('divide-y dark:divide-gray-700', isCollapsed && 'hidden')}>
                  {groupTasks.map(task => {
                    const age = ageDays(task.created_at)
                    const isOnHold = task.status === 'ON_HOLD'
                    return (
                      <div
                        key={task.task_id}
                        className={clsx(
                          'px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-2 cursor-pointer transition-colors',
                          isOnHold
                            ? 'bg-amber-50/60 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                        )}
                        onClick={() => navigate(`/shipments/${task.shipment_id}`)}
                      >
                        {/* BL Number */}
                        <span
                          className="font-semibold text-blue-600 dark:text-blue-400 text-sm w-36 shrink-0 hover:underline"
                          onClick={e => { e.stopPropagation(); navigate(`/shipments/${task.shipment_id}`) }}
                        >
                          {task.bl_number}
                        </span>

                        {/* Task type badge */}
                        <span className={clsx(
                          'text-xs font-semibold px-2 py-0.5 rounded-full shrink-0',
                          TASK_COLOR[task.task_type] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        )}>
                          {TASK_LABEL[task.task_type] ?? task.task_type}
                        </span>

                        {/* Status */}
                        {isOnHold ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 shrink-0">
                            ON HOLD{task.hold_entity ? ` — ${ENTITY_LABEL[task.hold_entity] ?? task.hold_entity}` : ''}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
                            In Progress
                          </span>
                        )}

                        {/* Stage */}
                        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                          {STAGE_LABEL[task.shipment_stage] ?? task.shipment_stage}
                        </span>

                        {/* Pull-out date if set */}
                        {task.pull_out_date && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                            Pull-out: <span className="font-medium text-gray-700 dark:text-gray-300">{formatDate(task.pull_out_date)}</span>
                          </span>
                        )}

                        {/* Hold remark */}
                        {task.hold_remark && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 italic truncate max-w-xs">
                            "{task.hold_remark}"
                          </span>
                        )}

                        {/* Age */}
                        <span className={clsx(
                          'ml-auto flex items-center gap-1 text-xs shrink-0',
                          age >= 7 ? 'text-red-500 dark:text-red-400 font-semibold' :
                          age >= 3 ? 'text-amber-500 dark:text-amber-400' :
                          'text-gray-400 dark:text-gray-500'
                        )}>
                          <Clock size={11} />
                          {age === 0 ? 'Today' : `${age}d`}
                        </span>

                        {/* Reassign (FFD/admin) */}
                        {canReassign && (
                          reassigningId === task.task_id ? (
                            <span className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                              <select
                                autoFocus
                                defaultValue=""
                                disabled={savingReassign}
                                onChange={e => { if (e.target.value) void reassign(task, e.target.value) }}
                                className="text-xs border dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="" disabled>Assign to…</option>
                                {proUsers.filter(u => u.id !== task.pro_user_id).map(u => (
                                  <option key={u.id} value={u.id}>{u.full_name} ({u.active_task_count})</option>
                                ))}
                              </select>
                              <button
                                onClick={() => setReassigningId(null)}
                                disabled={savingReassign}
                                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
                              >
                                cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); setReassigningId(task.task_id) }}
                              title={task.pro_user_id ? 'Reassign this task to another PRO' : 'Assign this task to a PRO'}
                              className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 rounded px-1.5 py-0.5 transition-colors"
                            >
                              <UserCheck size={11} /> {task.pro_user_id ? 'Reassign' : 'Assign'}
                            </button>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
