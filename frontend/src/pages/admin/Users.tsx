import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { companiesApi } from '@/api/companies'
import { formatDate } from '@/lib/dates'
import { useSortable } from '@/lib/sort'
import { SortableHeader } from '@/components/SortableHeader'
import toast from 'react-hot-toast'
import { Eye, EyeOff, Pencil, Check, X } from 'lucide-react'
import type { Team } from '@/types'
import { TEAM_LABELS } from '@/types'

const TEAMS: Team[] = ['CUSTOMER', 'FFD', 'PRO', 'TRANSPORT', 'DC', 'MANAGEMENT', 'CUSTOMER_MANAGEMENT']
const isCustomerTeamValue = (t: Team) => t === 'CUSTOMER' || t === 'CUSTOMER_MANAGEMENT'

type Mode = 'invite' | 'create'

export function AdminUsers() {
  const qc = useQueryClient()
  const { data: rawUsers = [] } = useQuery({ queryKey: ['users'], queryFn: () => authApi.listUsers().then(r => r.data) })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list().then(r => r.data) })
  const activeCompanies = companies.filter(c => c.is_active)
  const { sorted: users, sort, toggle } = useSortable(rawUsers, (u: any, col) => {
    switch (col) {
      case 'name':    return u.full_name
      case 'email':   return u.email
      case 'team':    return u.team
      case 'company': return u.company_name || ''
      case 'status':  return u.is_active ? 0 : 1
      case 'joined':  return u.created_at
      default:        return null
    }
  })

  const [mode, setMode] = useState<Mode>('create')

  // Invite state
  const [email, setEmail] = useState('')
  const [inviteTeam, setInviteTeam] = useState<Team>('FFD')
  const [inviteCompanyId, setInviteCompanyId] = useState('')
  const [inviting, setInviting] = useState(false)

  // Create state
  const [form, setForm] = useState({ full_name: '', email: '', password: '', team: 'FFD' as Team, company_id: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)

  // Pending team change to a customer team for users without a company:
  // the admin must pick the company before the change is applied
  const [pendingTeam, setPendingTeam] = useState<Record<string, Team>>({})

  // Companies section state
  const [newCompanyName, setNewCompanyName] = useState('')
  const [addingCompany, setAddingCompany] = useState(false)
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null)
  const [editingCompanyName, setEditingCompanyName] = useState('')

  function setField(k: keyof typeof form, v: string) {
    setForm(p => ({ ...p, [k]: v }))
  }

  async function invite() {
    if (!email.trim()) return
    if (isCustomerTeamValue(inviteTeam) && !inviteCompanyId) {
      toast.error('Select a company for customer team users')
      return
    }
    setInviting(true)
    try {
      await authApi.invite(email, inviteTeam, isCustomerTeamValue(inviteTeam) ? inviteCompanyId : null)
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
    if (isCustomerTeamValue(form.team) && !form.company_id) {
      toast.error('Select a company for customer team users')
      return
    }
    setCreating(true)
    try {
      await authApi.createUser({
        full_name: form.full_name, email: form.email, password: form.password, team: form.team,
        company_id: isCustomerTeamValue(form.team) ? form.company_id : null,
      })
      toast.success(`${form.full_name} created and can now log in`)
      setForm({ full_name: '', email: '', password: '', team: 'FFD', company_id: '' })
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

  async function changeTeam(u: any, team: Team) {
    // Moving into a customer team without a company: park the change until a company is picked
    if (isCustomerTeamValue(team) && !u.company_id) {
      setPendingTeam(p => ({ ...p, [u.id]: team }))
      toast('Choose a company to complete the team change', { icon: '🏢' })
      return
    }
    try {
      await authApi.updateTeam(u.id, team)
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Team updated')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update team')
    }
  }

  async function confirmPendingTeam(u: any, companyId: string) {
    const team = pendingTeam[u.id]
    if (!team || !companyId) return
    try {
      await authApi.updateTeam(u.id, team, companyId)
      setPendingTeam(p => { const { [u.id]: _, ...rest } = p; return rest })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Team and company updated')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update team')
    }
  }

  async function changeCompany(u: any, companyId: string) {
    try {
      await authApi.updateCompany(u.id, companyId)
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Company updated')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update company')
    }
  }

  async function addCompany() {
    if (!newCompanyName.trim()) return
    setAddingCompany(true)
    try {
      await companiesApi.create(newCompanyName.trim())
      toast.success(`Company "${newCompanyName.trim()}" created`)
      setNewCompanyName('')
      qc.invalidateQueries({ queryKey: ['companies'] })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create company')
    } finally {
      setAddingCompany(false)
    }
  }

  async function saveCompanyName(companyId: string) {
    if (!editingCompanyName.trim()) return
    try {
      await companiesApi.update(companyId, { name: editingCompanyName.trim() })
      setEditingCompanyId(null)
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Company renamed')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to rename company')
    }
  }

  async function toggleCompanyActive(companyId: string, active: boolean) {
    try {
      await companiesApi.update(companyId, { is_active: active })
      qc.invalidateQueries({ queryKey: ['companies'] })
      toast.success(active ? 'Company activated' : 'Company deactivated')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update company')
    }
  }

  const companySelectClasses = 'w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>

      {/* Customer companies card */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Customer Companies</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 max-w-lg">
            <input
              value={newCompanyName}
              onChange={e => setNewCompanyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCompany()}
              placeholder="New company name"
              className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addCompany}
              disabled={addingCompany || !newCompanyName.trim()}
              className="w-full sm:w-auto bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {addingCompany ? 'Adding…' : 'Add Company'}
            </button>
          </div>

          {companies.length > 0 && (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[440px]">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Company</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Users</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Shipments</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {companies.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-2 font-medium dark:text-gray-100">
                      {editingCompanyId === c.id ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            value={editingCompanyName}
                            onChange={e => setEditingCompanyName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveCompanyName(c.id)}
                            autoFocus
                            className="border dark:border-gray-600 rounded px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button onClick={() => saveCompanyName(c.id)} className="text-green-600 hover:text-green-700"><Check size={15} /></button>
                          <button onClick={() => setEditingCompanyId(null)} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {c.name}
                          <button
                            onClick={() => { setEditingCompanyId(c.id); setEditingCompanyName(c.name) }}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            title="Rename"
                          >
                            <Pencil size={13} />
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{c.user_count}</td>
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{c.shipment_count}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => toggleCompanyActive(c.id, !c.is_active)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 underline"
                      >
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    className={companySelectClasses}
                  >
                    {TEAMS.map(t => <option key={t} value={t}>{TEAM_LABELS[t]}</option>)}
                  </select>
                </div>
              </div>
              {isCustomerTeamValue(form.team) && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Company <span className="text-red-500">*</span></label>
                  <select
                    value={form.company_id}
                    onChange={e => setField('company_id', e.target.value)}
                    className={companySelectClasses}
                  >
                    <option value="">Select company…</option>
                    {activeCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
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
              <div className="flex flex-col sm:flex-row gap-2">
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
                  className="w-full sm:w-auto border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TEAMS.map(t => <option key={t} value={t}>{TEAM_LABELS[t]}</option>)}
                </select>
                <button
                  onClick={invite}
                  disabled={inviting || !email.trim()}
                  className="w-full sm:w-auto bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {inviting ? 'Sending…' : 'Send Invite'}
                </button>
              </div>
              {isCustomerTeamValue(inviteTeam) && (
                <div className="max-w-xs">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Company <span className="text-red-500">*</span></label>
                  <select
                    value={inviteCompanyId}
                    onChange={e => setInviteCompanyId(e.target.value)}
                    className={companySelectClasses}
                  >
                    <option value="">Select company…</option>
                    {activeCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Users list */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
            <tr>
              <SortableHeader label="Name"    column="name"    sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Email"   column="email"   sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell" />
              <SortableHeader label="Team"    column="team"    sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Company" column="company" sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Status"  column="status"  sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide" />
              <SortableHeader label="Joined"  column="joined"  sort={sort} onSort={toggle} className="px-4 py-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell" />
              <th />
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium dark:text-gray-100">{u.full_name}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{u.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={pendingTeam[u.id] ?? u.team}
                    onChange={e => changeTeam(u, e.target.value as Team)}
                    className="text-xs border dark:border-gray-600 rounded px-2 py-0.5 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {TEAMS.map(t => <option key={t} value={t}>{TEAM_LABELS[t]}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  {pendingTeam[u.id] ? (
                    <span className="flex items-center gap-1">
                      <select
                        defaultValue=""
                        onChange={e => e.target.value && confirmPendingTeam(u, e.target.value)}
                        className="text-xs border border-amber-400 rounded px-2 py-0.5 bg-amber-50 dark:bg-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="">Choose company…</option>
                        {activeCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button
                        onClick={() => setPendingTeam(p => { const { [u.id]: _, ...rest } = p; return rest })}
                        className="text-gray-400 hover:text-gray-600"
                        title="Cancel team change"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ) : isCustomerTeamValue(u.team) ? (
                    <select
                      value={u.company_id ?? ''}
                      onChange={e => e.target.value && changeCompany(u, e.target.value)}
                      className="text-xs border dark:border-gray-600 rounded px-2 py-0.5 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {!u.company_id && <option value="">No company</option>}
                      {activeCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      {u.company_id && !activeCompanies.some(c => c.id === u.company_id) && (
                        <option value={u.company_id}>{u.company_name || 'Deactivated company'}</option>
                      )}
                    </select>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 hidden sm:table-cell">{formatDate(u.created_at)}</td>
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
    </div>
  )
}
