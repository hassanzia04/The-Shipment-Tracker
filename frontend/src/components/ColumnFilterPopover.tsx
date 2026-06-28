import { useState, useRef, useEffect } from 'react'
import { Filter, X } from 'lucide-react'
import clsx from 'clsx'

export interface TextFilter {
  type: 'text'
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export interface SelectFilter {
  type: 'select'
  value: string
  onChange: (v: string) => void
  options: { label: string; value: string }[]
  allLabel?: string
}

export interface DateRangeFilter {
  type: 'daterange'
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}

export type ColumnFilter = TextFilter | SelectFilter | DateRangeFilter

function isActive(f: ColumnFilter): boolean {
  if (f.type === 'text') return !!f.value
  if (f.type === 'select') return !!f.value
  if (f.type === 'daterange') return !!(f.from || f.to)
  return false
}

interface Props {
  filter: ColumnFilter
}

export function ColumnFilterPopover({ filter }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = isActive(filter)

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  function clear() {
    if (filter.type === 'text') filter.onChange('')
    else if (filter.type === 'select') filter.onChange('')
    else { filter.onFromChange(''); filter.onToChange('') }
    setOpen(false)
  }

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center"
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen(o => !o)}
        title={active ? 'Filter active — click to edit' : 'Filter column'}
        className={clsx(
          'p-0.5 rounded transition-colors ml-0.5',
          active
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
        )}
      >
        <Filter size={10} fill={active ? 'currentColor' : 'none'} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-[200] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-2.5 min-w-[180px]">
          {filter.type === 'text' && (
            <div className="space-y-1.5">
              <input
                autoFocus
                type="text"
                value={filter.value}
                onChange={e => filter.onChange(e.target.value)}
                placeholder={filter.placeholder ?? 'Filter…'}
                onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
                className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              {active && (
                <button onClick={clear} className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700">
                  <X size={9} /> Clear
                </button>
              )}
            </div>
          )}

          {filter.type === 'select' && (
            <div className="space-y-1.5">
              <select
                autoFocus
                value={filter.value}
                onChange={e => filter.onChange(e.target.value)}
                className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">{filter.allLabel ?? 'All'}</option>
                {filter.options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {active && (
                <button onClick={clear} className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700">
                  <X size={9} /> Clear
                </button>
              )}
            </div>
          )}

          {filter.type === 'daterange' && (
            <div className="space-y-2">
              <div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">From</p>
                <input
                  type="date"
                  value={filter.from}
                  onChange={e => filter.onFromChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
                  className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">To</p>
                <input
                  type="date"
                  value={filter.to}
                  onChange={e => filter.onToChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
                  className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              {active && (
                <button onClick={clear} className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700 mt-0.5">
                  <X size={9} /> Clear dates
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
