import { useState, useEffect } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import type { Container } from '@/types'

interface Props {
  shipmentId: string
  existingContainers: Container[]
  onConfirmed: () => void
}

export function SalalahConfirmPanel({ shipmentId, existingContainers, onConfirmed }: Props) {
  const [containerNumbers, setContainerNumbers] = useState<string[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loadingSuggestions, setLoadingSuggestions] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingSuggestions(true)
    shipmentsApi.getBayanContainers(shipmentId)
      .then(res => {
        if (cancelled) return
        const existing = new Set(existingContainers.map(c => c.container_number.toUpperCase()))
        // Merge: start with already-registered containers, then add Bayan suggestions not yet registered
        const merged = [
          ...existingContainers.map(c => c.container_number),
          ...res.data.container_numbers.filter(n => !existing.has(n.toUpperCase())),
        ]
        setContainerNumbers(merged)
      })
      .catch(() => {
        if (cancelled) return
        // Fall back to whatever is already registered
        setContainerNumbers(existingContainers.map(c => c.container_number))
      })
      .finally(() => { if (!cancelled) setLoadingSuggestions(false) })
    return () => { cancelled = true }
  }, [shipmentId])

  function addContainer() {
    const num = inputValue.trim().toUpperCase()
    if (!num) return
    if (containerNumbers.map(n => n.toUpperCase()).includes(num)) {
      toast.error(`${num} is already in the list`)
      return
    }
    setContainerNumbers(prev => [...prev, num])
    setInputValue('')
  }

  function removeContainer(index: number) {
    setContainerNumbers(prev => prev.filter((_, i) => i !== index))
  }

  async function handleConfirm() {
    if (containerNumbers.length === 0) {
      toast.error('Add at least one container number before confirming')
      return
    }
    setSubmitting(true)
    try {
      await shipmentsApi.confirmSalalahTransport(shipmentId, containerNumbers)
      toast.success('Sent to Transport')
      onConfirmed()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Failed to confirm')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-green-800 dark:text-green-200">
          Salalah — Ready to Send to Transport
        </p>
        <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
          Bayan, DO, and Permit are complete. Review the container numbers extracted from the Bayan, then confirm to notify Transport and DC.
        </p>
      </div>

      {loadingSuggestions ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 size={13} className="animate-spin" /> Extracting container numbers from Bayan…
        </div>
      ) : (
        <div className="space-y-2">
          {containerNumbers.length > 0 ? (
            <ul className="space-y-1">
              {containerNumbers.map((num, i) => (
                <li key={i} className="flex items-center justify-between text-sm bg-white dark:bg-gray-800 border border-green-200 dark:border-green-700 rounded-lg px-3 py-1.5">
                  <span className="font-mono text-gray-800 dark:text-gray-100">{num}</span>
                  <button
                    onClick={() => removeContainer(i)}
                    className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 ml-2"
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No container numbers found in the Bayan. Add them manually below.
            </p>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addContainer() } }}
              placeholder="Add container number…"
              className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-400 font-mono"
            />
            <button
              onClick={addContainer}
              disabled={!inputValue.trim()}
              className="flex items-center gap-1 text-sm text-green-700 dark:text-green-300 border border-green-300 dark:border-green-600 px-3 py-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-40"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={submitting || loadingSuggestions || containerNumbers.length === 0}
        className="text-sm bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Sending…' : 'Confirm & Send to Transport'}
      </button>
    </div>
  )
}
