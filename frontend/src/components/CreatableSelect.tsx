import { useState, useRef, useEffect } from 'react'
import { Plus, Check, X, Loader } from 'lucide-react'
import clsx from 'clsx'

interface Option {
  id: string
  name: string
}

interface Props {
  label: string
  value: string
  onChange: (id: string) => void
  options: Option[]
  onAdd: (name: string) => Promise<Option>
  placeholder?: string
  required?: boolean
}

export function CreatableSelect({ label, value, onChange, options, onAdd, placeholder, required }: Props) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setError('')
    try {
      const created = await onAdd(name)
      onChange(created.id)
      setNewName('')
      setAdding(false)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to add')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
    if (e.key === 'Escape') { setAdding(false); setNewName('') }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      <div className="flex gap-2">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{placeholder || `Select ${label.toLowerCase()}…`}</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            title={`Add new ${label.toLowerCase()}`}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors shrink-0"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex gap-2 items-start">
          <div className="flex-1">
            <input
              ref={inputRef}
              value={newName}
              onChange={e => { setNewName(e.target.value); setError('') }}
              onKeyDown={handleKeyDown}
              placeholder={`New ${label.toLowerCase()} name…`}
              className={clsx('w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500', error && 'border-red-400')}
            />
            {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName(''); setError('') }}
            className="flex items-center justify-center w-9 h-9 rounded-lg border dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
