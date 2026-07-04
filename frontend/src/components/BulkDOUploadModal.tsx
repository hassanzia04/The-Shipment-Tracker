import { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, CheckCircle, AlertCircle, Loader, Search, Eye, RotateCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { documentsApi, type DOAnalysisItem } from '@/api/documents'
import { shipmentsApi } from '@/api/shipments'
import { isRetryableUploadError, uploadErrorDetail, newRowId } from '@/lib/uploadErrors'
import type { ShipmentListItem } from '@/types'
import clsx from 'clsx'

interface RowState {
  id: string
  file: File
  analysis: DOAnalysisItem | null
  analyzing: boolean
  shipmentId: string | null
  blNumber: string | null
  doDate: string
  hasExistingDoc: boolean
  completeTask: boolean
  uploadStatus: 'idle' | 'uploading' | 'done' | 'error'
  uploadResult: string | null
  retryable: boolean
}

interface Props {
  onClose: () => void
  onDone: () => void
  renewalMode?: boolean
}

export function BulkDOUploadModal({ onClose, onDone, renewalMode = false }: Props) {
  const [rows, setRows] = useState<RowState[]>([])
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback(async (accepted: File[]) => {
    const newRows: RowState[] = accepted.map(file => ({
      id: newRowId(),
      file,
      analysis: null,
      analyzing: true,
      shipmentId: null,
      blNumber: null,
      doDate: '',
      hasExistingDoc: false,
      completeTask: !renewalMode,
      uploadStatus: 'idle',
      uploadResult: null,
      retryable: false,
    }))
    setRows(prev => [...prev, ...newRows])

    try {
      const { data } = await documentsApi.analyzeDOs(accepted, renewalMode)
      // Match results to rows by stable id — the list may have changed
      // (rows removed, another batch dropped) while analysis was running
      const resultById = new Map(newRows.map((r, i) => [r.id, data[i]]))
      setRows(prev => prev.map(r => {
        const item = resultById.get(r.id)
        if (!item) return r
        return {
          ...r,
          analysis: item,
          analyzing: false,
          shipmentId: item.shipment_id,
          blNumber: item.bl_number,
          doDate: item.detected_date ?? '',
          hasExistingDoc: item.has_existing_doc,
        }
      }))
    } catch {
      const droppedIds = new Set(newRows.map(r => r.id))
      setRows(prev => prev.map(r => droppedIds.has(r.id) ? { ...r, analyzing: false } : r))
      toast.error('Failed to analyze files')
    }
  }, [renewalMode])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  })

  // All async row updates address rows by id, never by index — the list can
  // change (removals, extra drops) while uploads/analysis are in flight
  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  async function uploadRow(row: RowState): Promise<boolean> {
    if (!row.shipmentId || !row.doDate) return false
    setRow(row.id, { uploadStatus: 'uploading' })
    try {
      await documentsApi.upload({ shipment_id: row.shipmentId, doc_type: 'DO', file: row.file, force_replace: renewalMode || row.hasExistingDoc })
      await shipmentsApi.setDoValidity(row.shipmentId, row.doDate)
      if (row.completeTask) {
        try {
          await shipmentsApi.completeTaskByType(row.shipmentId, 'DO')
        } catch {
          toast.error(`Could not complete DO task for ${row.blNumber}`)
        }
      }
      setRow(row.id, { uploadStatus: 'done' })
      return true
    } catch (err: unknown) {
      setRow(row.id, { uploadStatus: 'error', uploadResult: uploadErrorDetail(err), retryable: isRetryableUploadError(err) })
      return false
    }
  }

  async function handleUpload() {
    setUploading(true)
    const eligible = rows.filter(r =>
      r.shipmentId && r.doDate && r.uploadStatus === 'idle' && (renewalMode || !r.hasExistingDoc)
    )
    const outcomes = await Promise.all(eligible.map(uploadRow))
    setUploading(false)

    const successCount = outcomes.filter(Boolean).length
    const errorCount = outcomes.length - successCount
    if (errorCount === 0) {
      toast.success(`${successCount} DO${successCount !== 1 ? 's' : ''} uploaded`)
      onDone()
      onClose()
    } else {
      toast.error(`${errorCount} file${errorCount !== 1 ? 's' : ''} failed — use Retry on the highlighted rows`)
    }
  }

  async function retryRow(row: RowState) {
    const ok = await uploadRow(row)
    if (ok) {
      toast.success(`${row.file.name} uploaded`)
      onDone()
    }
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  function setManualMatch(id: string, shipmentId: string, blNumber: string) {
    setRow(id, { shipmentId, blNumber, hasExistingDoc: false })
  }

  function unmatchRow(id: string) {
    setRow(id, { shipmentId: null, blNumber: null, hasExistingDoc: false })
  }

  function setCompleteTask(id: string, value: boolean) {
    setRow(id, { completeTask: value })
  }

  function setDate(id: string, date: string) {
    setRow(id, { doDate: date })
  }

  const matchedIds = new Set(rows.map(r => r.shipmentId).filter((id): id is string => id !== null))

  const allAnalyzed = rows.length > 0 && rows.every(r => !r.analyzing)
  const readyCount = rows.filter(r => r.shipmentId && r.doDate && r.uploadStatus === 'idle' && (!r.hasExistingDoc || renewalMode)).length
  const pendingDate = rows.filter(r => r.shipmentId && !r.doDate && r.uploadStatus === 'idle').length
  const pendingManual = rows.filter(r => !r.shipmentId && !r.analyzing && r.uploadStatus === 'idle').length
  const _today = new Date().toISOString().slice(0, 10)
  const expiredDoCount = renewalMode ? rows.filter(r => r.shipmentId && r.doDate && r.doDate < _today && r.uploadStatus === 'idle').length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{renewalMode ? 'Bulk DO Renewal' : 'Bulk DO Upload'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div
            {...getRootProps()}
            className={clsx(
              'border-2 border-dashed rounded-lg px-6 py-8 text-center cursor-pointer transition-colors',
              isDragActive
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700/40',
            )}
          >
            <input {...getInputProps()} />
            <Upload size={24} className="mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {isDragActive ? 'Drop DO PDFs here' : 'Drop DO PDFs here, or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mt-1">PDF only · multiple files supported</p>
          </div>

          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map(row => (
                <DOFileRow
                  key={row.id}
                  row={row}
                  matchedIds={matchedIds}
                  renewalMode={renewalMode}
                  onRemove={() => removeRow(row.id)}
                  onMatch={(sid, bl) => setManualMatch(row.id, sid, bl)}
                  onUnmatch={() => unmatchRow(row.id)}
                  onDateChange={date => setDate(row.id, date)}
                  onCompleteChange={v => setCompleteTask(row.id, v)}
                  onRetry={() => retryRow(row)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {rows.length === 0
              ? 'No files selected'
              : !allAnalyzed
              ? 'Analyzing files…'
              : pendingDate > 0
              ? `${pendingDate} file${pendingDate !== 1 ? 's' : ''} need a validity date`
              : pendingManual > 0
              ? `${pendingManual} file${pendingManual !== 1 ? 's' : ''} need manual assignment`
              : expiredDoCount > 0
              ? `${expiredDoCount} file${expiredDoCount !== 1 ? 's have' : ' has'} an expired DO date — enter a valid future date`
              : `${readyCount} file${readyCount !== 1 ? 's' : ''} ready to upload`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={readyCount === 0 || pendingDate > 0 || expiredDoCount > 0 || uploading || !allAnalyzed}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {uploading && <Loader size={14} className="animate-spin" />}
              Upload {readyCount > 0 ? `${readyCount} ` : ''}file{readyCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function openPdf(file: File) {
  const url = URL.createObjectURL(file)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function DOFileRow({
  row,
  matchedIds,
  renewalMode,
  onRemove,
  onMatch,
  onUnmatch,
  onDateChange,
  onCompleteChange,
  onRetry,
}: {
  row: RowState
  matchedIds: Set<string>
  renewalMode: boolean
  onRemove: () => void
  onMatch: (shipmentId: string, blNumber: string) => void
  onUnmatch: () => void
  onDateChange: (date: string) => void
  onCompleteChange: (v: boolean) => void
  onRetry: () => void
}) {
  const [searching, setSearching] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ShipmentListItem[]>([])
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchInitial() {
    setLoadingResults(true)
    try {
      const params = renewalMode
        ? { limit: 10, my_queue: true }
        : { limit: 10, my_queue: true, task_type_filter: 'DO' as const }
      const { data } = await shipmentsApi.list(params)
      setResults(data.items.filter(s => s.id === row.shipmentId || !matchedIds.has(s.id)))
    } catch {
      setResults([])
    } finally {
      setLoadingResults(false)
    }
  }

  function startSearching() {
    setSearching(true)
    void fetchInitial()
  }

  async function handleSearch(q: string) {
    setQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!q.trim()) { void fetchInitial(); return }
    setLoadingResults(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const params = renewalMode
          ? { search: q, limit: 8, my_queue: true }
          : { search: q, limit: 8, my_queue: true, task_type_filter: 'DO' as const }
        const { data } = await shipmentsApi.list(params)
        setResults(data.items.filter(s => s.id === row.shipmentId || !matchedIds.has(s.id)))
      } catch {
        setResults([])
      } finally {
        setLoadingResults(false)
      }
    }, 300)
  }

  const statusIcon = () => {
    if (row.uploadStatus === 'done') return <CheckCircle size={16} className="text-green-500 shrink-0" />
    if (row.uploadStatus === 'error') return <AlertCircle size={16} className="text-red-500 shrink-0" />
    if (row.uploadStatus === 'uploading') return <Loader size={16} className="animate-spin text-blue-500 shrink-0" />
    if (row.analyzing) return <Loader size={16} className="animate-spin text-gray-400 shrink-0" />
    if (row.shipmentId) return <CheckCircle size={16} className="text-green-500 shrink-0" />
    return <AlertCircle size={16} className="text-amber-500 shrink-0" />
  }

  const isDone = row.uploadStatus === 'done'

  return (
    <div className={clsx(
      'rounded-lg border px-4 py-3 flex flex-col gap-2',
      isDone
        ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/10'
        : row.uploadStatus === 'error'
        ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
    )}>
      <div className="flex items-center gap-3">
        {statusIcon()}
        <span className="text-sm text-gray-700 dark:text-gray-200 truncate flex-1" title={row.file.name}>
          {row.file.name}
        </span>
        <button
          onClick={() => openPdf(row.file)}
          title="Open PDF"
          className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
        >
          <Eye size={14} />
        </button>
        {!isDone && row.uploadStatus === 'idle' && (
          <button
            onClick={row.shipmentId ? onUnmatch : onRemove}
            title={row.shipmentId ? 'Remove match' : 'Remove file'}
            className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {row.uploadStatus === 'error' && (
        <div className="ml-7 space-y-1.5">
          {row.uploadResult && (
            <p className="text-xs text-red-600 dark:text-red-400">{row.uploadResult}</p>
          )}
          <div className="flex items-center gap-3">
            {row.retryable && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                <RotateCw size={11} /> Retry
              </button>
            )}
            <button
              onClick={onRemove}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:underline"
            >
              <X size={11} /> Remove
            </button>
          </div>
        </div>
      )}

      {!row.analyzing && row.uploadStatus === 'idle' && (
        row.shipmentId ? (
          <div className="flex flex-col gap-1.5 ml-7">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                BL: {row.blNumber}
              </span>
              <button
                onClick={startSearching}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline"
              >
                change
              </button>
              {(!row.hasExistingDoc || renewalMode) && (
                <>
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">Valid to:</span>
                  <input
                    type="date"
                    value={row.doDate}
                    onChange={e => onDateChange(e.target.value)}
                    className={clsx(
                      'text-xs border rounded px-2 py-0.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500',
                      row.doDate
                        ? 'border-gray-300 dark:border-gray-600'
                        : 'border-amber-400 dark:border-amber-500 ring-1 ring-amber-300',
                    )}
                  />
                  {!row.doDate && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">required</span>
                  )}
                  {!renewalMode && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer ml-auto">
                      <input
                        type="checkbox"
                        checked={row.completeTask}
                        onChange={e => onCompleteChange(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Complete task
                    </label>
                  )}
                </>
              )}
            </div>
            {row.hasExistingDoc && !renewalMode && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ A DO document already exists for this shipment — delete it first before re-uploading
              </p>
            )}
            {row.hasExistingDoc && renewalMode && (
              <p className="text-xs text-blue-600 dark:text-blue-400">
                ↻ Replaces existing DO — enter the new validity date above
              </p>
            )}
          </div>
        ) : (
          <div className="ml-7">
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">
              {row.analysis?.detected_bl
                ? `Detected BL "${row.analysis.detected_bl}" — no matching shipment found`
                : 'Could not detect BL number'}
            </p>
            {!searching && (
              <button
                onClick={startSearching}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <Search size={11} /> Assign manually
              </button>
            )}
          </div>
        )
      )}

      {searching && row.uploadStatus === 'idle' && (
        <div className="ml-7 relative">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by BL or invoice…"
            className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {(loadingResults || results.length > 0 || query.trim()) && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-52 overflow-y-auto">
              {loadingResults ? (
                <div className="px-3 py-3 flex justify-center"><Loader size={14} className="animate-spin text-gray-400" /></div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-400 text-center">No shipments found</div>
              ) : results.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    onMatch(s.id, s.bl_number)
                    setSearching(false)
                    setQuery('')
                    setResults([])
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b border-gray-100 dark:border-gray-700 last:border-0 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{s.bl_number}</div>
                    <div className="text-xs text-gray-400 truncate">{s.invoice_number}</div>
                  </div>
                  {s.offloading_point_name && (
                    <span className="text-xs text-gray-400 shrink-0 truncate max-w-[110px]">{s.offloading_point_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => { setSearching(false); setQuery(''); setResults([]) }}
            className="mt-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
