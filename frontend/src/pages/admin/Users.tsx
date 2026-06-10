import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { formatDate } from '@/lib/dates'
import { useSortable } from '@/lib/sort'
import { SortableHeader } from '@/components/SortableHeader'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import type { Team } from '@/types'

const TEAMS: Team[] = ['CUSTOMER', 'FFD', 'PRO', 'TRANSPORT', 'DC', 'MANAGEMENT', 'CUSTOMER_MANAGEMENT']

type Mode = 'invite' | 'create'

export function AdminUsers() {
  const qc = useQueryClient()
  const { data: rawUsers = [] } = useQuery({ queryKey: ['users'], queryFn: () => authApi.listUsers().then(r => r.data) })
  const { sorted: users, sort, toggle } = useSortable(rawUsers, (u: any, col) => {
    switch (col) {
      case 'name':   return u.full_name
      case 'email':  return u.email
      case 'team':   return u.team
      case 'status': return u.is_active ? 0 : 1
      case 'joined': return u.created_at
      default:       return null
    }
  })

  const [mode, setMode] = useState<Mode>('create')

  // Invite state
  const [email, setEmail] = useState('')
  const [inviteTeam, setInviteTeam] = useState<Team>('FFD')
  const [inviting, setInviting] = useState(false)

  // Create state
  const [form, setForm] = useState({ full_name: '', email: '', password: '', team: 'FFD' as Team })
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)

  function setField(k: keyof typeof form, v: string) {
    setForm(p => ({ ...p, [k]: v }))
  }

  async function invite() {
    if (!email.trim()) return
    setInviting(true)
    try {
      await authApi.invite(email, inviteTeam)
      toast.success(`Invitation sent to ${email}`)
      setEmail('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to send invitation')
    } finally {
      setInviting(false)
    }
  }

  async function createUser() {
    if (!form.full_name.trim() || !form.email.trim() || !form.password) {
      toast.error('Name, email and password are all required')
      return
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setCreating(true)
    try {
      await authApi.createUser(form)
      toast.success(`${form.full_name} created and can now log in`)
      setForm({ full_name: '', email: '', password: '', team: 'FFD' })
      qc.invalidateQueries({ queryKey: ['users'] })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(userId: string, active: boolean) {
    try {
      await authApi.toggleActive(userId, active)
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(active ? 'User activated' : 'User deactivated')
    } catch {
      toast.error('Failed to update user')
    }
  }

  async function changeTeam(userId: string, team: Team) {
    try {
      await authApi.updateTeam(userId, team)
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Team updated')
    } catch {
      toast.error('Failed to update team')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>

      {/* Add user card */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">

        {/* Mode tabs */}
        <div className="flex border-b dark:border-gray-700">
          {([['create', 'Create user directly'], ['invite', 'Send invite link']] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                mode === m
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {mode === 'create' ? (
            /* ── Create directly ── */
            <div className="space-y-3 max-w-lg">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                The user can log in immediately with the credentials you set here.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Full name <span className="text-red-500">*</span></label>
                  <input
                    value={form.full_name}
                    onChange={e => setField('full_name', e.target.value)}
                    placeholder="e.g. Hassan Al-Balushi"
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Team <span className="text-red-500">*</span></label>
                  <select
                    value={form.team}
                    onChange={e => setField('team', e.target.value)}
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setField('email', e.target.value)}
                  placeholder="user@example.com"
                  className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setField('password', e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 pr-10 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <button
                onClick={createUser}
                disabled={creating}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create User'}
              </button>
            </div>
          ) : (
            /* ── Invite link ── */
            <div className="space-y-3 max-w-lg">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                An invitation link is sent to the user's email. They set their own name and password.
              </p>
              <div className="flex gap-2">
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  type="email"
                  placeholder="Email address"
                  className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={inviteTeam}
                  onChange={e => setInviteTeam(e.target.value as Team)}
                  className="border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button
                  onClick={invite}
                  disabled={inviting || !email.trim()}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {inviting ? 'Sending…' : 'Send Invite'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Users list */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
            <tr>
              <SortableHeader label="Name"   column="name"   sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Email"  column="email"  sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Team"   column="team"   sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Status" column="status" sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Joined" column="joined" sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <th />
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium dark:text-gray-100">{u.full_name}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.team}
                    onChange={e => changeTeam(u.id, e.target.value as Team)}
                    className="text-xs border dark:border-gray-600 rounded px-2 py-0.5 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive(u.id, !u.is_active)}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 underline"
                  >
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
