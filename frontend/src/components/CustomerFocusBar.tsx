import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Star, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { authApi } from '@/api/auth'
import { companiesApi } from '@/api/companies'
import { isCustomerTeam } from '@/types'
import clsx from 'clsx'

/**
 * Personal customer-focus banner for internal users.
 * A view preference only — one click always reveals everything.
 *
 * States:
 *  - no focus set:   subtle "Focus on my customers" chip that opens the picker
 *  - focus applied:  blue banner naming the customers + "Show all" + edit
 *  - showing all:    neutral banner + "Back to my customers" + edit
 * Hidden entirely when an explicit company filter is active (it wins).
 */
export function CustomerFocusBar({ showingAll, onShowingAllChange, suppressed = false }: {
  showingAll: boolean
  onShowingAllChange: (v: boolean) => void
  suppressed?: boolean
}) {
  const { user, refresh } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isInternal = !!user && !isCustomerTeam(user)

  const { data: companies = [] } = useQuery({
    queryKey: ['companies', 'active'],
    queryFn: () => companiesApi.list(true).then(r => r.data),
    enabled: isInternal,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!editing) return
    function handleOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setEditing(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [editing])

  if (!isInternal || suppressed) return null

  const focusIds = user?.focus_company_ids ?? []
  const focusNames = companies.filter(c => focusIds.includes(c.id)).map(c => c.name)

  function openEditor() {
    setDraft(new Set(focusIds))
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    try {
      await authApi.updateFocusCompanies(Array.from(draft))
      await refresh()
      setEditing(false)
      onShowingAllChange(false)
      toast.success(draft.size > 0 ? 'Customer focus saved' : 'Customer focus cleared')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to save customer focus')
    } finally {
      setSaving(false)
    }
  }

  const picker = editing && (
    <div ref={popoverRef} className="absolute top-full left-0 z-30 mt-1 w-64 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-xl p-3">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">My customers</p>
      <div className="max-h-48 overflow-y-auto space-y-1 mb-3">
        {companies.map(c => (
          <label key={c.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={draft.has(c.id)}
              onChange={e => setDraft(prev => {
                const next = new Set(prev)
                if (e.target.checked) next.add(c.id)
                else next.delete(c.id)
                return next
              })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {c.name}
          </label>
        ))}
        {companies.length === 0 && <p className="text-xs text-gray-400">No active customers found.</p>}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1">Cancel</button>
        <button
          onClick={save}
          disabled={saving}
          className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )

  // No focus configured — just the entry point
  if (focusIds.length === 0) {
    return (
      <div className="relative inline-block mb-3">
        <button
          onClick={openEditor}
          className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 rounded-full px-3 py-1.5 transition-colors"
          title="Pick the customers you work with — your lists will open filtered to them"
        >
          <Star size={12} /> Focus on my customers
        </button>
        {picker}
      </div>
    )
  }

  return (
    <div className={clsx(
      'relative flex items-center gap-2 flex-wrap rounded-lg border px-3 py-2 mb-3 text-sm',
      showingAll
        ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
        : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'
    )}>
      <Star size={14} className={showingAll ? 'text-gray-400' : 'text-blue-500'} />
      {showingAll ? (
        <>
          <span>Showing <strong>all customers</strong></span>
          <button
            onClick={() => onShowingAllChange(false)}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Back to my customers ({focusIds.length})
          </button>
        </>
      ) : (
        <>
          <span>
            Showing your customers: <strong>{focusNames.length > 0 ? focusNames.join(', ') : `${focusIds.length} selected`}</strong>
          </span>
          <button
            onClick={() => onShowingAllChange(true)}
            className="text-xs font-semibold hover:underline"
          >
            Show all
          </button>
        </>
      )}
      <button
        onClick={openEditor}
        title="Change my customers"
        className="ml-auto p-1 rounded text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
      >
        <Pencil size={12} />
      </button>
      {picker}
    </div>
  )
}
