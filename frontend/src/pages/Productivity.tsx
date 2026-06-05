import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useSortable } from '@/lib/sort'
import { SortableHeader } from '@/components/SortableHeader'
import { Clock, CheckCircle, AlertTriangle, Users } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import clsx from 'clsx'

const PERIODS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: 'All time', value: 0 },
]

const TASK_COLORS: Record<string, string> = {
  PERMIT:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  DO:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  BAYAN:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  CCRO:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CCRO_ROP: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const TASK_LABELS: Record<string, string> = {
  PERMIT:   'Permit',
  DO:       'DO',
  BAYAN:    'Bayan',
  CCRO:     'CCRO',
  CCRO_ROP: 'CCRO ROP',
}

function formatTime(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours}h`
  const d = Math.floor(hours / 24)
  const h = Math.round(hours % 24)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

interface TaskBreakdownEntry {
  count: number
  avg_hours: number | null
}

interface UserStat {
  id: string
  full_name: string
  email: string
  is_active: boolean
  tasks_completed: number
  avg_completion_hours: number | null
  task_breakdown: Record<string, TaskBreakdownEntry>
}

interface TeamData {
  team: string
  active_tasks: number
  on_hold_tasks: number
  users: UserStat[]
}

interface ProductivityData {
  period_days: number
  teams: TeamData[]
}

function StatChip({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number; color: string
}) {
  return (
    <div className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium', color)}>
      {icon}
      <span>{value} {label}</span>
    </div>
  )
}

function UserRow({ user, rank }: { user: UserStat; rank: number }) {
  const breakdown = Object.entries(user.task_breakdown).sort((a, b) => b[1].count - a[1].count)

  return (
    <tr className={clsx(
      'border-b dark:border-gray-700 last:border-0',
      !user.is_active && 'opacity-50'
    )}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400 dark:text-gray-500 w-5">#{rank}</span>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {user.full_name}
              {!user.is_active && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">(inactive)</span>
              )}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={clsx(
          'text-2xl font-bold',
          user.tasks_completed === 0
            ? 'text-gray-300 dark:text-gray-600'
            : 'text-gray-900 dark:text-white'
        )}>
          {user.tasks_completed}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {breakdown.length === 0 ? (
            <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
          ) : (
            breakdown.map(([type, entry]) => (
              <div
                key={type}
                className={clsx('flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium', TASK_COLORS[type] || 'bg-gray-100 text-gray-600')}
              >
                <span>{TASK_LABELS[type] || type}</span>
                <span className="font-bold">{entry.count}</span>
                {entry.avg_hours !== null && (
                  <span className="flex items-center gap-0.5 opacity-75">
                    <Clock size={10} />
                    {formatTime(entry.avg_hours)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </td>
    </tr>
  )
}

function TeamSection({ team }: { team: TeamData }) {
  const { sorted, sort, toggle } = useSortable(team.users, (u, col) => {
    switch (col) {
      case 'member':    return u.full_name
      case 'completed': return u.tasks_completed
      default:          return null
    }
  })
  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Team header */}
      <div className="px-5 py-4 border-b dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
            <Users size={16} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">{team.team} Team</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{team.users.length} member{team.users.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatChip
            icon={<CheckCircle size={14} />}
            label="active"
            value={team.active_tasks}
            color="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
          />
          {team.on_hold_tasks > 0 && (
            <StatChip
              icon={<AlertTriangle size={14} />}
              label="on hold"
              value={team.on_hold_tasks}
              color="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
            />
          )}
        </div>
      </div>

      {/* User table */}
      {team.users.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No members in this team</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <SortableHeader label="Member"    column="member"    sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Completed" column="completed" sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" />
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Task Breakdown (count · avg time)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u, i) => (
              <UserRow key={u.id} user={u} rank={i + 1} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function Productivity() {
  const [days, setDays] = useState(30)
  const { user } = useAuth()
  const isSelfView = user?.team === 'PRO' && !user?.is_admin

  const { data, isLoading } = useQuery<ProductivityData>({
    queryKey: ['productivity', days],
    queryFn: () => api.get('/analytics/productivity', { params: { days } }).then(r => r.data),
    staleTime: 2 * 60_000,
  })

  const totalCompleted = data?.teams.reduce((sum, t) => sum + t.users.reduce((s, u) => s + u.tasks_completed, 0), 0) ?? 0
  const periodLabel = PERIODS.find(p => p.value === days)?.label ?? ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {isSelfView ? 'My Productivity' : 'Team Productivity'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {isSelfView ? 'Your personal task completion stats' : 'FFD and PRO team performance'}
          </p>
        </div>

        {/* Period selector */}
        <div className="flex border dark:border-gray-600 rounded-lg overflow-hidden">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setDays(p.value)}
              className={clsx(
                'px-3 py-2 text-sm font-medium transition-colors',
                days === p.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      {!isLoading && data && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold">Tasks completed</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{totalCompleted}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">in {periodLabel}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold">Active tasks</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
              {data.teams.reduce((s, t) => s + t.active_tasks, 0)}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">across all queues</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold">On hold</p>
            <p className={clsx(
              'text-3xl font-bold mt-1',
              data.teams.reduce((s, t) => s + t.on_hold_tasks, 0) > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-gray-900 dark:text-white'
            )}>
              {data.teams.reduce((s, t) => s + t.on_hold_tasks, 0)}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">tasks blocked</p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}
          </div>
          <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl" />
          <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        </div>
      )}

      {/* Team sections */}
      {!isLoading && data && data.teams.map(team => (
        <TeamSection key={team.team} team={team} />
      ))}
    </div>
  )
}
