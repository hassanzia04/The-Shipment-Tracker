import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Dashboard } from './pages/Dashboard'
import { ShipmentList } from './pages/ShipmentList'
import { ShipmentDetail } from './pages/ShipmentDetail'
import { NewShipment } from './pages/NewShipment'
import { Settings } from './pages/Settings'
import { AdminUsers } from './pages/admin/Users'
import { AdminMasters } from './pages/admin/Masters'
import { Productivity } from './pages/Productivity'
import { ImportShipments } from './pages/customer/ImportShipments'
import { Reports } from './pages/Reports'
import { ProTasks } from './pages/ProTasks'
import { Component, ReactNode } from 'react'

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!user) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

function ManagementOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.team !== 'MANAGEMENT' && !user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

function ProductivityAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.team !== 'MANAGEMENT' && user?.team !== 'PRO' && !user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

function MastersAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.team !== 'FFD' && user?.team !== 'CUSTOMER' && user?.team !== 'TRANSPORT' && !user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

function ProTasksAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.team !== 'FFD' && user?.team !== 'MANAGEMENT' && !user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

interface EBState { error: Error | null }
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900 px-6">
        <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">Something went wrong</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md text-center">{this.state.error.message}</p>
        <button
          onClick={() => { this.setState({ error: null }); window.location.href = '/' }}
          className="mt-2 text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          Go to Dashboard
        </button>
      </div>
    )
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/shipments" element={<Protected><ShipmentList /></Protected>} />
            <Route path="/shipments/new" element={<Protected><NewShipment /></Protected>} />
            <Route path="/import" element={<Protected><ImportShipments /></Protected>} />
            <Route path="/reports" element={<Protected><Reports /></Protected>} />
            <Route path="/shipments/:id" element={<Protected><ShipmentDetail /></Protected>} />
            <Route path="/settings" element={<Protected><Settings /></Protected>} />
            <Route path="/productivity" element={<Protected><ProductivityAccess><Productivity /></ProductivityAccess></Protected>} />
            <Route path="/admin/users" element={<Protected><AdminOnly><AdminUsers /></AdminOnly></Protected>} />
            <Route path="/masters" element={<Protected><MastersAccess><AdminMasters /></MastersAccess></Protected>} />
            <Route path="/admin/masters" element={<Protected><AdminOnly><AdminMasters /></AdminOnly></Protected>} />
            <Route path="/pro-tasks" element={<Protected><ProTasksAccess><ProTasks /></ProTasksAccess></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
