import { useState, useEffect } from 'react'
import { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Ship, LayoutDashboard, Settings, LogOut, Users, Moon, Sun, BarChart2, Truck, FolderOpen, Menu, X, TrendingUp, Database, ClipboardList, Search } from 'lucide-react'
import clsx from 'clsx'
import { NotificationBell } from '@/components/NotificationBell'
import { QuickSearch } from '@/components/QuickSearch'
import { TEAM_LABELS } from '@/types'

type NavItem = { label: string; href: string; icon: React.ElementType }

function getBottomNavItems(user: { team: string; is_admin: boolean } | null): NavItem[] {
  const D = { label: 'Dashboard',   href: '/',           icon: LayoutDashboard }
  const S = { label: 'Shipments',   href: '/shipments',  icon: Ship }
  const R = { label: 'Reports',     href: '/reports',    icon: TrendingUp }
  const T = { label: 'Trucks',      href: '/masters',    icon: Truck }
  const P = { label: 'PRO Tasks',   href: '/pro-tasks',  icon: ClipboardList }
  const Y = { label: 'Productivity',href: '/productivity',icon: BarChart2 }

  switch (user?.team) {
    case 'CUSTOMER':            return [D, S, R]
    case 'CUSTOMER_MANAGEMENT': return [D, S, R]
    case 'FFD':        return [D, S, R, P]
    case 'MANAGEMENT': return [D, S, R, P]
    case 'PRO':        return [D, S, R, Y]
    case 'TRANSPORT':  return [D, S, T, R]
    case 'DC':         return [D, S, R]
    default:           return user?.is_admin ? [D, S, P, R] : [D, S, R]
  }
}

interface Props { children: ReactNode }

const NAV = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Shipments', href: '/shipments', icon: Ship },
]

export function Layout({ children }: Props) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function navLink(href: string, label: string, Icon: React.ElementType, exact = true) {
    const active = exact ? location.pathname === href : location.pathname.startsWith(href)
    return (
      <Link
        key={href}
        to={href}
        onClick={() => setOpen(false)}
        className={clsx(
          'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          active
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
        )}
      >
        <Icon size={16} />
        {label}
      </Link>
    )
  }

  const sidebarContent = (
    <>
      <div className="px-4 py-5 border-b dark:border-gray-700 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-blue-500 dark:text-blue-400 uppercase">AMLS</p>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Shipment Tracker</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{user ? TEAM_LABELS[user.team] : ''}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setOpen(false); setSearchOpen(true) }}
            title="Search shipments (Ctrl+K)"
            className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <Search size={16} />
          </button>
          <span className="hidden lg:block"><NotificationBell align="left" /></span>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {NAV.map(({ label, href, icon }) => navLink(href, label, icon))}
        {(user?.team === 'MANAGEMENT' || user?.team === 'PRO' || user?.is_admin) && navLink('/productivity', 'Productivity', BarChart2)}
        {(user?.team === 'FFD' || user?.team === 'MANAGEMENT' || user?.team === 'CUSTOMER' || user?.team === 'CUSTOMER_MANAGEMENT' || user?.team === 'TRANSPORT' || user?.is_admin) && navLink('/reports', 'Reports', TrendingUp)}
        {(user?.team === 'FFD' || user?.team === 'MANAGEMENT' || user?.is_admin) && navLink('/pro-tasks', 'PRO Tasks', ClipboardList)}
        {(user?.team === 'FFD' || user?.team === 'CUSTOMER' || user?.is_admin) && navLink('/masters', 'Masters', Database)}
        {user?.team === 'TRANSPORT' && navLink('/masters', 'Trucks', Truck)}
        {user?.team === 'CUSTOMER' && navLink('/import', 'Create Shipment', FolderOpen)}
        {user?.is_admin && navLink('/admin/users', 'Admin', Users, false)}
        {navLink('/settings', 'Settings', Settings)}
      </nav>

      <div className="px-2 py-4 border-t dark:border-gray-700 space-y-1">
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{user?.full_name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
        </div>
        <button
          onClick={toggle}
          className="flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <LogOut size={16} /> Sign out
        </button>
        <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 mt-2 cursor-default select-none">
          v2.0.0
        </p>
        <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 cursor-default select-none">
          Developed by Bayanat Technology
        </p>
      </div>
    </>
  )

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-900">

      <QuickSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — always visible on lg+, slide-in drawer on mobile */}
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col transition-transform duration-200 ease-in-out',
        'lg:static lg:w-56 lg:translate-x-0 lg:z-auto',
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {sidebarContent}
      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="p-1.5 -ml-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Menu size={20} />
          </button>
          <span className="font-semibold text-gray-900 dark:text-white text-sm truncate min-w-0 flex-1">Shipment Tracker</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              title="Search shipments"
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Search size={18} />
            </button>
            <NotificationBell />
            <span className="text-xs text-gray-500 dark:text-gray-400">{user ? TEAM_LABELS[user.team] : ''}</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      {(() => {
        const bottomItems = getBottomNavItems(user)
        return (
          <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex items-stretch h-16">
            {bottomItems.map(({ label, href, icon: Icon }) => {
              const active = href === '/' ? location.pathname === '/' : location.pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  to={href}
                  className={clsx(
                    'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                    active
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                  {label}
                </Link>
              )
            })}
            {/* More — opens sidebar */}
            <button
              onClick={() => setOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400"
            >
              <Menu size={20} strokeWidth={1.8} />
              More
            </button>
          </nav>
        )
      })()}
    </div>
  )
}
