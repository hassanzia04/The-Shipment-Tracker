import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import clsx from 'clsx'
import { notificationsApi, AppNotification } from '@/api/notifications'

interface Props {
  align?: 'left' | 'right'
}

export function NotificationBell({ align = 'right' }: Props) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.is_read).length

  useEffect(() => {
    document.title = unreadCount > 0
      ? `(${unreadCount}) AMLS Shipment Tracker`
      : 'AMLS Shipment Tracker'
  }, [unreadCount])

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.getMyNotifications()
      setNotifications(res.data)
    } catch {
      // silently ignore — network errors shouldn't break the UI
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
    const id = setInterval(fetchNotifications, 30_000)
    return () => clearInterval(id)
  }, [fetchNotifications])

  useEffect(() => {
    if (!open) return
    function onOutsideClick(e: MouseEvent | TouchEvent) {
      const target = e.target as Node
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    document.addEventListener('touchstart', onOutsideClick)
    return () => {
      document.removeEventListener('mousedown', onOutsideClick)
      document.removeEventListener('touchstart', onOutsideClick)
    }
  }, [open])

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const panelWidth = 320 // w-80
      setDropdownPos({
        top: rect.bottom + 6,
        left: align === 'right'
          ? Math.max(4, rect.right - panelWidth)
          : Math.min(rect.left, window.innerWidth - panelWidth - 4),
      })
    }
    setOpen(o => !o)
  }

  async function handleMarkAllRead() {
    await notificationsApi.markAllRead()
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  async function handleClickNotification(notif: AppNotification) {
    if (!notif.is_read) {
      await notificationsApi.markRead([notif.id])
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n)
      )
    }
    setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="relative p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none pointer-events-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
          className="fixed w-80 max-w-[calc(100vw-1rem)] bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-xl overflow-hidden z-[9999] flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700 flex-shrink-0">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto max-h-[70vh]">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell size={28} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map(notif => (
                <Link
                  key={notif.id}
                  to={notif.shipment_id ? `/shipments/${notif.shipment_id}` : '#'}
                  onClick={() => handleClickNotification(notif)}
                  className={clsx(
                    'flex items-start gap-3 px-4 py-3 border-b dark:border-gray-700/50 last:border-0 transition-colors',
                    notif.is_read
                      ? 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                      : 'bg-blue-50/60 dark:bg-blue-900/15 hover:bg-blue-50 dark:hover:bg-blue-900/25'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-white leading-snug line-clamp-3">
                      {notif.payload.body}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                      {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  {!notif.is_read && (
                    <span className="mt-1 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                </Link>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
