import { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, CheckCircle, AlertCircle, Loader, Search, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { documentsApi, type DOAnalysisItem } from '@/api/documents'
import { shipmentsApi } from '@/api/shipments'
import type { ShipmentListItem } from '@/types'
import clsx from 'clsx'

interface RowState {
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
}

interface Props {
  onClose: () => void
  onDone: () => void
}

export function BulkDOUploadModal({ onClose, onDone }: Props) {
  const [rows, setRows] = useState<RowState[]>([])
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback(async (accepted: File[]) => {
    const newRows: RowState[] = accepted.map(file => ({
      file,
      analysis: null,
      analyzing: true,
      shipmentId: null,
      blNumber: null,
      doDate: '',
      hasExistingDoc: false,
      completeTask: true,
      uploadStatus: 'idle',
      uploadResult: null,
    }))
    setRows(prev => [...prev, ...newRows])

    try {
      const { data } = await documentsApi.analyzeDOs(accepted)
      setRows(prev => {
        const updated = [...prev]
        const offset = updated.length - accepted.length
        data.forEach((item, i) => {
          const idx = offset + i
          if (updated[idx]) {
            updated[idx] = {
              ...updated[idx],
              analysis: item,
              analyzing: false,
              shipmentId: item.shipment_id,
              blNumber: item.bl_number,
              doDate: item.detected_date ?? '',
              hasExistingDoc: item.has_existing_doc,
            }
          }
        })
        return updated
      })
    } catch {
      setRows(prev => prev.map(r => r.analyzing ? { ...r, analyzing: false } : r))
      toast.error('Failed to analyze files')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  })

  async function handleUpload() {
    setUploading(true)
    let successCount = 0
    let errorCount = 0

    await Promise.all(
      rows.map(async (row, idx) => {
        if (!row.shipmentId || !row.doDate || row.uploadStatus !== 'idle' || row.hasExistingDoc) return
        setRows(prev => {
          const updated = [...prev]
          updated[idx] = { ...updated[idx], uploadStatus: 'uploading' }
          return updated
        })
        try {
          await documentsApi.upload({ shipment_id: row.shipmentId, doc_type: 'DO', file: row.file })
          await shipmentsApi.setDoValidity(row.shipmentId, row.doDate)
          if (row.completeTask) {
            try {
              await shipmentsApi.completeTaskByType(row.shipmentId, 'DO')
            } catch {
              toast.error(`Could not complete DO task for ${row.blNumber}`)
            }
          }
          setRows(prev => {
            const updated = [...prev]
            updated[idx] = { ...updated[idx], uploadStatus: 'done' }
            return updated
          })
          successCount++
        } catch (err: unknown) {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          const message = typeof detail === 'string' ? detail : 'Upload failed'
          setRows(prev => {
            const updated = [...prev]
            updated[idx] = { ...updated[idx], uploadStatus: 'error', uploadResult: message }
            return updated
          })
          errorCount++
        }
      })
    )

    setUploading(false)
    if (errorCount === 0) {
      toast.success(`${successCount} DO${successCount !== 1 ? 's' : ''} uploaded`)
      onDone()
      onClose()
    } else {
      toast.error(`${errorCount} file${errorCount !== 1 ? 's' : ''} failed to upload`)
    }
  }

  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  function setManualMatch(idx: number, shipmentId: string, blNumber: string) {
    setRows(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], shipmentId, blNumber, hasExistingDoc: false }
      return updated
    })
  }

  function unmatchRow(idx: number) {
    setRows(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], shipmentId: null, blNumber: null, hasExistingDoc: false }
      return updated
    })
  }

  function setCompleteTask(idx: number, value: boolean) {
    setRows(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], completeTask: value }
      return updated
    })
  }

  function setDate(idx: number, date: string) {
    setRows(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], doDate: date }
      return updated
    })
  }

  const matchedIds = new Set(rows.map(r => r.shipmentId).filter((id): id is string => id !== null))

  const allAnalyzed = rows.length > 0 && rows.every(r => !r.analyzing)
  const readyCount = rows.filter(r => r.shipmentId && r.doDate && r.uploadStatus === 'idle' && !r.hasExistingDoc).length
  const pendingDate = rows.filter(r => r.shipmentId && !r.doDate && r.uploadStatus === 'idle').length
  const pendingManual = rows.filter(r => !r.shipmentId && !r.analyzing && r.uploadStatus === 'idle').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Bulk DO Upload</h2>
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
              {rows.map((row, idx) => (
                <DOFileRow
                  key={`${row.file.name}-${idx}`}
                  row={row}
                  matchedIds={matchedIds}
                  onRemove={() => removeRow(idx)}
                  onMatch={(sid, bl) => setManualMatch(idx, sid, bl)}
                  onUnmatch={() => unmatchRow(idx)}
                  onDateChange={date => setDate(idx, date)}
                  onCompleteChange={v => setCompleteTask(idx, v)}
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
              disabled={readyCount === 0 || pendingDate > 0 || uploading || !allAnalyzed}
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
  onRemove,
  onMatch,
  onUnmatch,
  onDateChange,
  onCompleteChange,
}: {
  row: RowState
  matchedIds: Set<string>
  onRemove: () => void
  onMatch: (shipmentId: string, blNumber: string) => void
  onUnmatch: () => void
  onDateChange: (date: string) => void
  onCompleteChange: (v: boolean) => void
}) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ShipmentListItem[]>([])
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchInitial() {
    try {
      const { data } = await shipmentsApi.list({ limit: 10, my_queue: true, task_type_filter: 'DO' })
      setResults(data.items.filter(s => s.id === row.shipmentId || !matchedIds.has(s.id)))
    } catch {
      setResults([])
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
    searchTimeout.current = setTimeout(async () => {
      try {
        const { data } = await shipmentsApi.list({ search: q, limit: 8, my_queue: true, task_type_filter: 'DO' })
        setResults(data.items.filter(s => s.id === row.shipmentId || !matchedIds.has(s.id)))
      } catch {
        setResults([])
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

      {row.uploadStatus === 'error' && row.uploadResult && (
        <p className="text-xs text-red-600 dark:text-red-400 ml-7">{row.uploadResult}</p>
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
              {!row.hasExistingDoc && (
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
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer ml-auto">
                    <input
                      type="checkbox"
                      checked={row.completeTask}
                      onChange={e => onCompleteChange(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Complete task
                  </label>
                </>
              )}
            </div>
            {row.hasExistingDoc && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ A DO document already exists for this shipment — delete it first before re-uploading
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
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg max-h-40 overflow-y-auto">
              {results.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    onMatch(s.id, s.bl_number)
                    setSearching(false)
                    setQuery('')
                    setResults([])
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 flex justify-between gap-2"
                >
                  <span className="font-medium">{s.bl_number}</span>
                  <span className="text-gray-400">{s.invoice_number}</span>
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
