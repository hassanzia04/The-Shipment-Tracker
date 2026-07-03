import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader, X } from 'lucide-react'
import { shipmentsApi } from '@/api/shipments'
import { STAGE_LABELS } from '@/types'
import type { ShipmentListItem, ShipmentStage } from '@/types'
import clsx from 'clsx'

// Global shipment finder: opens with Ctrl/Cmd+K, searches BL + invoice across
// active and completed shipments, Enter/click jumps to the shipment.
export function QuickSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ShipmentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) { setQuery(''); setResults([]); setHighlighted(0) }
  }, [open])

  const runSearch = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const [active, completed] = await Promise.all([
        shipmentsApi.list({ search: q, limit: 6 }),
        shipmentsApi.list({ search: q, limit: 6, historical: true }).catch(() => null),
      ])
      const seen = new Set<string>()
      const merged: ShipmentListItem[] = []
      for (const s of [...active.data.items, ...(completed?.data.items ?? [])]) {
        if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) }
      }
      setResults(merged.slice(0, 8))
      setHighlighted(0)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  function handleChange(q: string) {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(() => void runSearch(q.trim()), 250)
  }

  function select(s: ShipmentListItem) {
    onClose()
    navigate(`/shipments/${s.id}`)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && results[highlighted]) { e.preventDefault(); select(results[highlighted]) }
    else if (e.key === 'Escape') onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border dark:border-gray-700"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b dark:border-gray-700">
          {loading ? <Loader size={16} className="animate-spin text-gray-400 shrink-0" /> : <Search size={16} className="text-gray-400 shrink-0" />}
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by BL or invoice number…"
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
          />
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        {query.trim() && (
          <div className="max-h-80 overflow-y-auto">
            {results.length === 0 && !loading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No shipments found</p>
            ) : (
              results.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => select(s)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={clsx(
                    'w-full text-left px-4 py-3 flex items-center justify-between gap-3 border-b dark:border-gray-700 last:border-0',
                    i === highlighted ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{s.bl_number}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {s.invoice_number}
                      {s.company_name ? ` · ${s.company_name}` : ''}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">
                    {STAGE_LABELS[s.current_stage as ShipmentStage] ?? s.current_stage}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/40 text-[10px] text-gray-400 flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
