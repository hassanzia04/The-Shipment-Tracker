import {
  CheckCircle, AlertTriangle, ArrowRight, FileText, Package,
  Truck, UserCheck, Lock, Unlock, Calendar, Info, RotateCcw,
  Clock, PlusCircle, Container,
} from 'lucide-react'
import type { ShipmentEvent, Task } from '@/types'
import { STAGE_LABELS, TASK_TYPE_LABELS } from '@/types'
import type { ShipmentStage, TaskType } from '@/types'
import { formatDateTime, formatDuration } from '@/lib/dates'
import clsx from 'clsx'

interface Props {
  events: ShipmentEvent[]
  tasks?: Pick<Task, 'id' | 'task_type'>[]
}

// ── Per-event-type visual config ─────────────────────────────────────────────

type Cfg = { icon: React.ReactNode; ring: string; iconColor: string; labelClass: string }

function cfg(eventType: string): Cfg {
  switch (eventType) {
    case 'TASK_COMPLETED':
    case 'DOCUMENTS_APPROVED':
    case 'CONTAINER_OFFLOADED':
    case 'CONTAINER_RETURNED':
      return { icon: <CheckCircle size={13} />, ring: 'ring-green-300 dark:ring-green-700', iconColor: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30', labelClass: 'text-green-700 dark:text-green-400' }
    case 'TASK_HOLD_RELEASED':
      return { icon: <Unlock size={13} />, ring: 'ring-green-300 dark:ring-green-700', iconColor: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30', labelClass: 'text-green-700 dark:text-green-400' }
    case 'DOCUMENTS_REJECTED':
    case 'SENT_BACK_TO_FFD':
    case 'BREAKDOWN_REPORTED':
      return { icon: <AlertTriangle size={13} />, ring: 'ring-red-300 dark:ring-red-700', iconColor: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30', labelClass: 'text-red-700 dark:text-red-400' }
    case 'TASK_HOLD_ASSIGNED':
      return { icon: <Lock size={13} />, ring: 'ring-amber-300 dark:ring-amber-700', iconColor: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30', labelClass: 'text-amber-700 dark:text-amber-400' }
    case 'STAGE_CHANGED':
      return { icon: <ArrowRight size={13} />, ring: 'ring-purple-300 dark:ring-purple-700', iconColor: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30', labelClass: 'text-purple-700 dark:text-purple-400' }
    case 'TASK_ASSIGNED':
      return { icon: <UserCheck size={13} />, ring: 'ring-blue-200 dark:ring-blue-700', iconColor: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30', labelClass: 'text-gray-800 dark:text-gray-100' }
    case 'TASK_CREATED':
      return { icon: <PlusCircle size={13} />, ring: 'ring-blue-200 dark:ring-blue-700', iconColor: 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30', labelClass: 'text-gray-800 dark:text-gray-100' }
    case 'TRUCK_ASSIGNED':
      return { icon: <Truck size={13} />, ring: 'ring-blue-200 dark:ring-blue-700', iconColor: 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30', labelClass: 'text-gray-800 dark:text-gray-100' }
    case 'CONTAINER_ADDED':
      return { icon: <Container size={13} />, ring: 'ring-gray-200 dark:ring-gray-600', iconColor: 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700', labelClass: 'text-gray-700 dark:text-gray-300' }
    case 'PULL_OUT_DATE_CHANGED':
    case 'DO_VALIDITY_UPDATED':
      return { icon: <Calendar size={13} />, ring: 'ring-gray-200 dark:ring-gray-600', iconColor: 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700', labelClass: 'text-gray-700 dark:text-gray-300' }
    case 'SHIPMENT_CREATED':
      return { icon: <Package size={13} />, ring: 'ring-blue-300 dark:ring-blue-700', iconColor: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30', labelClass: 'text-gray-900 dark:text-white font-semibold' }
    case 'DOCUMENTS_SUBMITTED':
      return { icon: <FileText size={13} />, ring: 'ring-blue-200 dark:ring-blue-700', iconColor: 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30', labelClass: 'text-gray-800 dark:text-gray-100' }
    default:
      return { icon: <Info size={13} />, ring: 'ring-gray-200 dark:ring-gray-600', iconColor: 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700', labelClass: 'text-gray-700 dark:text-gray-300' }
  }
}

// ── Dynamic label ─────────────────────────────────────────────────────────────

function getLabel(event: ShipmentEvent, taskName: string | undefined): string {
  const t = taskName ?? ''
  switch (event.event_type) {
    case 'SHIPMENT_CREATED':       return 'Shipment created'
    case 'DOCUMENTS_SUBMITTED':    return 'Documents submitted for review'
    case 'DOCUMENTS_REJECTED':     return 'Documents sent back — returned to customer'
    case 'DOCUMENTS_APPROVED':     return 'Documents approved — tasks opened'
    case 'TASK_CREATED':           return t ? `${t} task opened` : 'Task opened'
    case 'TASK_ASSIGNED':          return t ? `${t} task assigned to PRO member` : 'Task assigned'
    case 'TASK_HOLD_ASSIGNED':     return t ? `${t} task put on hold` : 'Hold assigned'
    case 'TASK_HOLD_RELEASED':     return t ? `${t} task hold released` : 'Hold released'
    case 'TASK_COMPLETED':         return t ? `${t} task completed` : 'Task completed'
    case 'STAGE_CHANGED': {
      const to = event.stage_to ? (STAGE_LABELS[event.stage_to as ShipmentStage] ?? event.stage_to) : null
      return to ? `Moved to ${to}` : 'Stage advanced'
    }
    case 'CONTAINER_ADDED':        return 'Container added'
    case 'TRUCK_ASSIGNED':         return 'Truck & driver assigned to container'
    case 'BREAKDOWN_REPORTED':     return 'Breakdown / delay reported'
    case 'CONTAINER_OFFLOADED':    return 'Container offloaded at DC'
    case 'CONTAINER_RETURNED':     return 'Container returned'
    case 'SENT_BACK_TO_FFD':       return 'Shipment sent back to FFD team'
    case 'PULL_OUT_DATE_CHANGED':      return 'Pull-out date updated'
    case 'SHIPMENT_DETAILS_CHANGED':   return 'Shipment details updated'
    case 'DO_VALIDITY_UPDATED':        return 'DO validity date updated'
    default:                           return event.event_type.replace(/_/g, ' ').toLowerCase()
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StageTimeline({ events, tasks }: Props) {
  const taskTypeById: Record<string, string> = {}
  if (tasks) {
    for (const t of tasks) {
      taskTypeById[t.id] = TASK_TYPE_LABELS[t.task_type as TaskType] ?? t.task_type
    }
  }

  return (
    <div className="space-y-0">
      {events.map((event, idx) => {
        const { icon, ring, iconColor, labelClass } = cfg(event.event_type)
        const taskName = event.task_id ? taskTypeById[event.task_id] : undefined
        const label = getLabel(event, taskName)
        const isLast = idx === events.length - 1

        return (
          <div key={event.id} className="flex gap-3">
            {/* Icon column */}
            <div className="flex flex-col items-center shrink-0">
              <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center ring-2 mt-0.5', ring, iconColor)}>
                {icon}
              </div>
              {!isLast && <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 my-1" />}
            </div>

            {/* Content */}
            <div className={clsx('flex-1 min-w-0', isLast ? 'pb-0' : 'pb-4')}>
              {/* Label + timestamp */}
              <div className="flex items-start justify-between gap-2">
                <p className={clsx('text-sm font-medium leading-snug', labelClass)}>{label}</p>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 mt-0.5">{formatDateTime(event.created_at)}</span>
              </div>

              {/* Actor */}
              {event.actor_name && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  By <span className="font-medium text-gray-700 dark:text-gray-200">{event.actor_name}</span>
                  {event.actor_team && (
                    <span className="ml-1 text-gray-400 dark:text-gray-500 capitalize">
                      ({event.actor_team.replace('_', ' ').toLowerCase()})
                    </span>
                  )}
                </p>
              )}

              {/* Remark */}
              {event.remark && (
                <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300 italic bg-gray-50 dark:bg-gray-700/60 rounded px-2.5 py-1.5 border-l-2 border-gray-200 dark:border-gray-600">
                  {event.remark}
                </p>
              )}

              {/* Duration */}
              {event.duration_seconds != null && event.duration_seconds > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Clock size={10} className="shrink-0" />
                  {formatDuration(event.duration_seconds)} since previous event
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
