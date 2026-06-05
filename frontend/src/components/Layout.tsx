import { useState } from 'react'
import { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Ship, LayoutDashboard, Settings, LogOut, Users, Moon, Sun, BarChart2, Truck, FolderOpen, Menu, X, TrendingUp, Database } from 'lucide-react'
import clsx from 'clsx'

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
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Shipment Tracker</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{user?.team}</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="lg:hidden p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {NAV.map(({ label, href, icon }) => navLink(href, label, icon))}
        {(user?.team === 'MANAGEMENT' || user?.team === 'PRO' || user?.is_admin) && navLink('/productivity', 'Productivity', BarChart2)}
        {(user?.team === 'FFD' || user?.team === 'MANAGEMENT' || user?.team === 'CUSTOMER' || user?.team === 'TRANSPORT' || user?.is_admin) && navLink('/reports', 'Reports', TrendingUp)}
        {(user?.team === 'FFD' || user?.team === 'CUSTOMER' || user?.is_admin) && navLink('/masters', 'Masters', Database)}
        {user?.team === 'CUSTOMER' && navLink('/import', 'Create Shipment', FolderOpen)}
        {(user?.team === 'TRANSPORT' || user?.is_admin) && navLink('/trucks', 'Trucks', Truck)}
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
        <p
          title="Developed by Hassan Zia"
          className="text-center text-[10px] text-gray-400 dark:text-gray-600 mt-2 cursor-default select-none"
        >
          v1.0.0-beta
        </p>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900">

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
          <span className="font-semibold text-gray-900 dark:text-white text-sm">Shipment Tracker</span>
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{user?.team}</span>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
