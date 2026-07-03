import { useState, useEffect } from 'react'
import { X, Loader, CheckCircle, Plus, Package, ExternalLink, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import { documentsApi } from '@/api/documents'
import clsx from 'clsx'

interface SalalahRow {
  shipment_id: string
  bl_number: string
  containers: string[]
  inputValue: string
  bayan_document_id: string | null
}

interface Props {
  onClose: () => void
  onDone: () => void
}

export function BulkSalalahConfirmModal({ onClose, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<SalalahRow[]>([])
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const [confirmedCount, setConfirmedCount] = useState(0)
  // Server-reported conflicts, keyed `${shipment_id}:${NUMBER}` → conflicting BL
  const [conflicts, setConflicts] = useState<Record<string, string>>({})
  const [validating, setValidating] = useState(false)

  // Numbers appearing under more than one shipment inside this modal
  const localDups = (() => {
    const count = new Map<string, number>()
    rows.forEach(r => new Set(r.containers.map(c => c.toUpperCase())).forEach(c => count.set(c, (count.get(c) ?? 0) + 1)))
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([c]) => c))
  })()

  const conflictCount = rows.reduce(
    (n, r) => n + r.containers.filter(c =>
      conflicts[`${r.shipment_id}:${c.toUpperCase()}`] || localDups.has(c.toUpperCase())
    ).length,
    0,
  )

  // Re-validate against active shipments whenever the container lists change
  const containersKey = JSON.stringify(rows.map(r => [r.shipment_id, r.containers]))
  useEffect(() => {
    if (loading || done || rows.length === 0) return
    const t = setTimeout(async () => {
      setValidating(true)
      try {
        const { data } = await shipmentsApi.validateContainers(
          rows.map(r => ({ shipment_id: r.shipment_id, container_numbers: r.containers }))
        )
        const map: Record<string, string> = {}
        data.conflicts.forEach(c => { map[`${c.shipment_id}:${c.container_number}`] = c.conflict_bl })
        setConflicts(map)
      } catch { /* advisory only — the confirm endpoint stays guarded server-side */ }
      finally { setValidating(false) }
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersKey, loading, done])

  useEffect(() => {
    shipmentsApi.getSalalahReady()
      .then(async ({ data }) => {
        const resolved = await Promise.all(
          data.items.map(async item => {
            const existing = item.existing_containers.map(c => c.toUpperCase())
            const existingSet = new Set(existing)
            try {
              const { data: sugData } = await shipmentsApi.getBayanContainers(item.shipment_id)
              const newSuggestions = sugData.container_numbers.filter(s => !existingSet.has(s.toUpperCase()))
              return {
                shipment_id: item.shipment_id,
                bl_number: item.bl_number,
                containers: [...existing, ...newSuggestions],
                inputValue: '',
                bayan_document_id: sugData.bayan_document_id,
              }
            } catch {
              return { shipment_id: item.shipment_id, bl_number: item.bl_number, containers: existing, inputValue: '', bayan_document_id: null }
            }
          })
        )
        setRows(resolved)
      })
      .catch(() => toast.error('Failed to load eligible Salalah shipments'))
      .finally(() => setLoading(false))
  }, [])

  function addContainer(rowIdx: number) {
    const val = rows[rowIdx].inputValue.trim().toUpperCase()
    if (!val) return
    if (rows[rowIdx].containers.includes(val)) {
      toast.error('Container already in list')
      return
    }
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, containers: [...r.containers, val], inputValue: '' } : r))
  }

  function removeContainer(rowIdx: number, ci: number) {
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, containers: r.containers.filter((_, j) => j !== ci) } : r))
  }

  function setInput(rowIdx: number, value: string) {
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, inputValue: value } : r))
  }

  async function openBayan(documentId: string) {
    try {
      const { data } = await documentsApi.getContent(documentId)
      const url = URL.createObjectURL(data as Blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch {
      toast.error('Could not open Bayan PDF')
    }
  }

  async function handleConfirm() {
    const invalid = rows.filter(r => r.containers.length === 0)
    if (invalid.length > 0) {
      toast.error(`BL ${invalid[0].bl_number} has no containers — add at least one before confirming`)
      return
    }
    if (conflictCount > 0) {
      toast.error('Remove the highlighted duplicate containers before confirming')
      return
    }
    setConfirming(true)
    try {
      const { data } = await shipmentsApi.bulkConfirmSalalah(
        rows.map(r => ({ shipment_id: r.shipment_id, container_numbers: r.containers }))
      )
      setConfirmedCount(data.confirmed)
      setDone(true)
      onDone()
    } catch {
      toast.error('Failed to confirm Salalah shipments')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Salalah Confirmation</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Confirm container numbers and send eligible Salalah shipments to Transport
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader size={24} className="animate-spin mr-2" />
              <span>Loading eligible shipments…</span>
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package size={40} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">No Salalah shipments are ready for transport</p>
              <p className="text-xs mt-1 text-center">
                Shipments appear here only when Bayan, DO, and Permit tasks are all complete.
              </p>
            </div>
          )}

          {!loading && done && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CheckCircle size={48} className="text-green-500" />
              <p className="text-base font-semibold text-gray-800 dark:text-gray-100">
                {confirmedCount} shipment{confirmedCount !== 1 ? 's' : ''} confirmed
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                Transport and DC have been notified with the combined email.
              </p>
            </div>
          )}

          {!loading && !done && rows.map((row, rowIdx) => (
            <div key={row.shipment_id} className="border dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{row.bl_number}</span>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{row.containers.length} container{row.containers.length !== 1 ? 's' : ''}</span>
                {row.bayan_document_id && (
                  <button
                    onClick={() => openBayan(row.bayan_document_id!)}
                    className="ml-auto flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <ExternalLink size={11} /> View Bayan
                  </button>
                )}
              </div>

              {/* Container badges */}
              <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
                {row.containers.length === 0 && (
                  <span className="text-xs text-gray-400 italic">No containers yet — add below</span>
                )}
                {row.containers.map((c, ci) => {
                  const conflictBl = conflicts[`${row.shipment_id}:${c.toUpperCase()}`]
                  const isLocalDup = localDups.has(c.toUpperCase())
                  const isDup = !!conflictBl || isLocalDup
                  return (
                    <span
                      key={ci}
                      title={conflictBl
                        ? `Duplicate — already active on shipment ${conflictBl}`
                        : isLocalDup
                        ? 'Duplicate — this number is also listed under another shipment in this dialog'
                        : undefined}
                      className={clsx(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-medium border',
                        isDup
                          ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700'
                          : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700',
                      )}
                    >
                      {isDup && <AlertTriangle size={10} />}
                      {c}
                      <button
                        onClick={() => removeContainer(rowIdx, ci)}
                        className={clsx('ml-0.5', isDup ? 'text-red-400 hover:text-red-600 dark:hover:text-red-200' : 'text-blue-400 hover:text-blue-600 dark:hover:text-blue-200')}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  )
                })}
              </div>

              {/* Add container input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={row.inputValue}
                  onChange={e => setInput(rowIdx, e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addContainer(rowIdx) } }}
                  placeholder="Add container number…"
                  className="flex-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => addContainer(rowIdx)}
                  disabled={!row.inputValue.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {!done && (
          <div className="border-t dark:border-gray-700 p-4 flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
            {conflictCount > 0 ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                <AlertTriangle size={13} />
                {conflictCount} duplicate container{conflictCount !== 1 ? 's' : ''} — remove the highlighted number{conflictCount !== 1 ? 's' : ''} before confirming.
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {rows.length > 0
                  ? `${rows.length} shipment${rows.length !== 1 ? 's' : ''} will be confirmed — a combined email goes to Transport and DC.`
                  : 'No eligible shipments found.'}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg"
              >
                Cancel
              </button>
              {rows.length > 0 && !loading && (
                <button
                  onClick={handleConfirm}
                  disabled={confirming || validating || conflictCount > 0}
                  title={conflictCount > 0 ? 'Resolve the highlighted duplicate containers first' : undefined}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(confirming || validating) ? <Loader size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Confirm All & Send to Transport
                </button>
              )}
            </div>
          </div>
        )}

        {done && (
          <div className="border-t dark:border-gray-700 p-4 flex justify-end bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
