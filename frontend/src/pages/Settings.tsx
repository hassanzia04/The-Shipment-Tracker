import { FormEvent, useEffect, useState } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { authApi } from '@/api/auth'
import { notificationsApi, CCConfig, DailyReportRecipient } from '@/api/notifications'
import { companiesApi } from '@/api/companies'
import type { User, Company } from '@/types'
import { TEAM_LABELS } from '@/types'
import { Moon, Sun, Plus, X, Clock } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const CC_TEAMS = ['FFD', 'TRANSPORT', 'DC'] as const

export function Settings() {
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  // CC config state (admin only)
  const [ccConfigs, setCCConfigs] = useState<CCConfig[]>([])
  const [proUsers, setProUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [newCCEmail, setNewCCEmail] = useState('')
  const [ccSaving, setCCSaving] = useState(false)

  // Daily report state (admin only)
  const [reportRecipients, setReportRecipients] = useState<DailyReportRecipient[]>([])
  const [reportSendTime, setReportSendTime] = useState('17:30')
  const [reportTimeInput, setReportTimeInput] = useState('17:30')
  const [reportTimeSaving, setReportTimeSaving] = useState(false)
  const [newReportEmail, setNewReportEmail] = useState('')
  // null = not adding; 'internal' = full-report list; else = company id
  const [reportEmailAdding, setReportEmailAdding] = useState<string | null>(null)
  const [reportEmailSaving, setReportEmailSaving] = useState(false)

  const pwMismatch = confirmPw.length > 0 && newPw !== confirmPw
  const pwTooShort = newPw.length > 0 && newPw.length < 8
  const pwAllAlpha = newPw.length >= 8 && /^[a-zA-Z]+$/.test(newPw)

  useEffect(() => {
    if (!user?.is_admin) return
    notificationsApi.listCCConfigs().then(r => setCCConfigs(r.data)).catch(() => {})
    authApi.listTeamMembers('PRO').then(r => setProUsers(r.data)).catch(() => {})
    companiesApi.list(true).then(r => setCompanies(r.data)).catch(() => {})
    notificationsApi.listDailyReportRecipients().then(r => setReportRecipients(r.data)).catch(() => {})
    notificationsApi.getDailyReportConfig().then(r => {
      setReportSendTime(r.data.send_time)
      setReportTimeInput(r.data.send_time)
    }).catch(() => {})
  }, [user?.is_admin])

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { toast.error('Passwords do not match'); return }
    setPwLoading(true)
    try {
      await authApi.changePassword(currentPw, newPw)
      toast.success('Password updated')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update password')
    } finally {
      setPwLoading(false)
    }
  }

  async function handleAddCC(e: FormEvent, team: string | null, proUserId: string | null, companyId?: string) {
    e.preventDefault()
    if (!newCCEmail.trim()) return
    setCCSaving(true)
    try {
      const payload = team
        ? { team, cc_email: newCCEmail.trim(), ...(companyId ? { company_id: companyId } : {}) }
        : { pro_user_id: proUserId!, cc_email: newCCEmail.trim() }
      const res = await notificationsApi.createCCConfig(payload)
      setCCConfigs(prev => [...prev, res.data])
      setNewCCEmail('')
      setAddingFor(null)
      toast.success('CC email added')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to add CC email')
    } finally {
      setCCSaving(false)
    }
  }

  async function handleRemoveCC(id: string) {
    try {
      await notificationsApi.deleteCCConfig(id)
      setCCConfigs(prev => prev.filter(c => c.id !== id))
      toast.success('CC email removed')
    } catch {
      toast.error('Failed to remove CC email')
    }
  }

  async function handleSaveReportTime(e: FormEvent) {
    e.preventDefault()
    setReportTimeSaving(true)
    try {
      await notificationsApi.updateDailyReportConfig(reportTimeInput)
      setReportSendTime(reportTimeInput)
      toast.success('Send time updated')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update send time')
    } finally {
      setReportTimeSaving(false)
    }
  }

  async function handleAddReportRecipient(e: FormEvent, companyId?: string) {
    e.preventDefault()
    if (!newReportEmail.trim()) return
    setReportEmailSaving(true)
    try {
      const res = await notificationsApi.addDailyReportRecipient(newReportEmail.trim(), companyId)
      setReportRecipients(prev => [...prev, res.data])
      setNewReportEmail('')
      setReportEmailAdding(null)
      toast.success('Recipient added')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to add recipient')
    } finally {
      setReportEmailSaving(false)
    }
  }

  async function handleRemoveReportRecipient(id: string) {
    try {
      await notificationsApi.removeDailyReportRecipient(id)
      setReportRecipients(prev => prev.filter(r => r.id !== id))
      toast.success('Recipient removed')
    } catch {
      toast.error('Failed to remove recipient')
    }
  }

  function CCRow({
    rowKey,
    label,
    configs,
    team,
    proUserId,
    companyId,
  }: {
    rowKey: string
    label: string
    configs: CCConfig[]
    team: string | null
    proUserId: string | null
    companyId?: string
  }) {
    const isAdding = addingFor === rowKey
    return (
      <div className="py-2 border-b dark:border-gray-700 last:border-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
          {!isAdding && (
            <button
              onClick={() => { setAddingFor(rowKey); setNewCCEmail('') }}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Plus size={12} /> Add email
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mt-1">
          {configs.map(c => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full px-3 py-1"
            >
              {c.cc_email}
              <button onClick={() => handleRemoveCC(c.id)} className="ml-1 text-gray-400 hover:text-red-500">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        {isAdding && (
          <form
            onSubmit={e => handleAddCC(e, team, proUserId, companyId)}
            className="flex gap-2 mt-2"
          >
            <input
              type="email"
              autoFocus
              placeholder="email@example.com"
              value={newCCEmail}
              onChange={e => setNewCCEmail(e.target.value)}
              required
              className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={ccSaving}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setAddingFor(null); setNewCCEmail('') }}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1.5 text-xs"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>

      {/* Profile */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Profile</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Name</p>
            <p className="font-medium text-gray-900 dark:text-white">{user?.full_name}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Email</p>
            <p className="font-medium text-gray-900 dark:text-white">{user?.email}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Team</p>
            <p className="font-medium text-gray-900 dark:text-white">{user ? TEAM_LABELS[user.team] : ''}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Role</p>
            <p className="font-medium text-gray-900 dark:text-white">{user?.is_admin ? 'Admin' : 'Member'}</p>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Change Password</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Current password
            </label>
            <input
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              New password
            </label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              required
              className={clsx(
                'w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2',
                (pwTooShort || pwAllAlpha)
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
              )}
            />
            {pwTooShort && (
              <p className="mt-1 text-xs text-red-500">At least 8 characters required</p>
            )}
            {!pwTooShort && pwAllAlpha && (
              <p className="mt-1 text-xs text-red-500">Must include at least one digit or special character</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              required
              className={clsx(
                'w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2',
                pwMismatch
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
              )}
            />
            {pwMismatch && (
              <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
            )}
          </div>
          <button
            type="submit"
            disabled={pwLoading || pwMismatch || pwTooShort || pwAllAlpha}
            className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {pwLoading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>

      {/* Appearance */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Appearance</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setTheme('light')}
            className={clsx(
              'flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
              theme === 'light'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
            )}
          >
            <Sun size={24} className={theme === 'light' ? 'text-blue-600' : 'text-gray-400'} />
            <span className={clsx('text-sm font-medium', theme === 'light' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400')}>
              Light
            </span>
            <div className="w-full h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
              <div className="w-8 h-1.5 bg-gray-200 rounded" />
            </div>
          </button>

          <button
            onClick={() => setTheme('dark')}
            className={clsx(
              'flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
              theme === 'dark'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
            )}
          >
            <Moon size={24} className={theme === 'dark' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'} />
            <span className={clsx('text-sm font-medium', theme === 'dark' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400')}>
              Dark
            </span>
            <div className="w-full h-12 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center">
              <div className="w-8 h-1.5 bg-gray-700 rounded" />
            </div>
          </button>
        </div>
      </div>

      {/* Alert CC Configuration — admin only */}
      {user?.is_admin && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Alert CC Configuration</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Emails added here will be CC'd on every alert sent to that team or individual PRO.
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-3 mb-1">Teams</p>
            {CC_TEAMS.map(team => (
              <CCRow
                key={team}
                rowKey={team}
                label={team}
                configs={ccConfigs.filter(c => c.team === team)}
                team={team}
                proUserId={null}
              />
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-3 mb-1">Customer Companies</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
              CC'd only on emails about that company's shipments — never across companies.
            </p>
            {companies.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-1">No active companies found.</p>
            )}
            {companies.map(company => (
              <CCRow
                key={company.id}
                rowKey={`customer-${company.id}`}
                label={company.name}
                configs={ccConfigs.filter(c => c.team === 'CUSTOMER' && c.company_id === company.id)}
                team="CUSTOMER"
                proUserId={null}
                companyId={company.id}
              />
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-3 mb-1">PRO Individuals</p>
            {proUsers.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-1">No PRO users found.</p>
            )}
            {proUsers.map(pro => (
              <CCRow
                key={pro.id}
                rowKey={pro.id}
                label={pro.full_name}
                configs={ccConfigs.filter(c => c.pro_user_id === pro.id)}
                team={null}
                proUserId={pro.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Daily Report — admin only */}
      {user?.is_admin && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-5">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Daily Operations Report</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Sent once per day at the configured Muscat time. Internal recipients get the full report across all customers; enabled customer companies get their own edition covering only their shipments.
            </p>
          </div>

          {/* Send time */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Send Time (Muscat / AST)</p>
            <form onSubmit={handleSaveReportTime} className="flex items-center gap-3">
              <div className="relative">
                <Clock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="time"
                  value={reportTimeInput}
                  onChange={e => setReportTimeInput(e.target.value)}
                  className="border dark:border-gray-600 rounded-lg pl-8 pr-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={reportTimeSaving || reportTimeInput === reportSendTime}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {reportTimeSaving ? 'Saving…' : 'Save'}
              </button>
            </form>
          </div>

          {/* Recipients */}
          {(() => {
            function RecipientRow({ rowKey, label, recipients, companyId }: {
              rowKey: string
              label: string
              recipients: DailyReportRecipient[]
              companyId?: string
            }) {
              const isAdding = reportEmailAdding === rowKey
              return (
                <div className="py-2 border-b dark:border-gray-700 last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
                    {!isAdding && (
                      <button
                        onClick={() => { setReportEmailAdding(rowKey); setNewReportEmail('') }}
                        className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <Plus size={12} /> Add recipient
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {recipients.map(r => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full px-3 py-1"
                      >
                        {r.email}
                        <button onClick={() => handleRemoveReportRecipient(r.id)} className="ml-1 text-gray-400 hover:text-red-500">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    {recipients.length === 0 && !isAdding && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {companyId ? 'Not sent — add an email to enable this customer’s report' : 'No recipients yet'}
                      </span>
                    )}
                  </div>
                  {isAdding && (
                    <form onSubmit={e => handleAddReportRecipient(e, companyId)} className="flex gap-2 mt-2">
                      <input
                        type="email"
                        autoFocus
                        placeholder="email@example.com"
                        value={newReportEmail}
                        onChange={e => setNewReportEmail(e.target.value)}
                        required
                        className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        disabled={reportEmailSaving}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => { setReportEmailAdding(null); setNewReportEmail('') }}
                        className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              )
            }
            return (
              <>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Full Report (all customers)</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                    Your leadership circle — these addresses receive the complete report covering every customer.
                  </p>
                  <RecipientRow
                    rowKey="internal"
                    label="Internal recipients"
                    recipients={reportRecipients.filter(r => !r.company_id)}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-3 mb-1">Customer Editions</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                    Each company gets the same report filtered to only its shipments — sent only for companies with at least one recipient (key clients).
                  </p>
                  {companies.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-1">No active companies found.</p>
                  )}
                  {companies.map(company => (
                    <RecipientRow
                      key={company.id}
                      rowKey={company.id}
                      label={company.name}
                      recipients={reportRecipients.filter(r => r.company_id === company.id)}
                      companyId={company.id}
                    />
                  ))}
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
