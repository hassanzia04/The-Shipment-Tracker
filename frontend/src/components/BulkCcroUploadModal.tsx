import { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, CheckCircle, AlertCircle, Loader, Search, Eye, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { documentsApi, type CcroAnalysisItem } from '@/api/documents'
import { shipmentsApi } from '@/api/shipments'
import type { ShipmentListItem } from '@/types'
import clsx from 'clsx'

type UploadStatus = 'idle' | 'uploading' | 'done' | 'duplicate' | 'not_detected' | 'error'

interface RowState {
  file: File
  analysis: CcroAnalysisItem | null
  analyzing: boolean
  shipmentId: string | null
  blNumber: string | null
  containerCount: number | null
  detectedContainer: string | null
  hasExistingDoc: boolean
  conflictBl: string | null
  hasActiveCcroTask: boolean
  uploadStatus: UploadStatus
  uploadResult: string | null
}

interface Props {
  onClose: () => void
  onDone: () => void
}

function openPdf(file: File) {
  const url = URL.createObjectURL(file)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function BulkCcroUploadModal({ onClose, onDone }: Props) {
  const [rows, setRows] = useState<RowState[]>([])
  const [uploading, setUploading] = useState(false)
  const [confirmingTransport, setConfirmingTransport] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<string[]>([])

  const onDrop = useCallback(async (accepted: File[]) => {
    const newRows: RowState[] = accepted.map(file => ({
      file,
      analysis: null,
      analyzing: true,
      shipmentId: null,
      blNumber: null,
      containerCount: null,
      detectedContainer: null,
      hasExistingDoc: false,
      conflictBl: null,
      hasActiveCcroTask: false,
      uploadStatus: 'idle',
      uploadResult: null,
    }))
    setRows(prev => [...prev, ...newRows])

    try {
      const { data } = await documentsApi.analyzeCCROs(accepted)
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
              containerCount: item.container_count,
              detectedContainer: item.detected_container,
              hasExistingDoc: item.has_existing_doc,
              conflictBl: item.conflict_bl,
              hasActiveCcroTask: item.has_active_ccro_task,
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

    // Group idle+matched rows by shipment_id
    const grouped = new Map<string, { rowIndexes: number[]; files: File[] }>()
    rows.forEach((row, idx) => {
      if (!row.shipmentId || row.uploadStatus !== 'idle' || row.hasExistingDoc || row.conflictBl || !row.hasActiveCcroTask) return
      if (!grouped.has(row.shipmentId)) grouped.set(row.shipmentId, { rowIndexes: [], files: [] })
      grouped.get(row.shipmentId)!.rowIndexes.push(idx)
      grouped.get(row.shipmentId)!.files.push(row.file)
    })

    // Mark all as uploading
    setRows(prev => {
      const updated = [...prev]
      for (const { rowIndexes } of grouped.values()) {
        rowIndexes.forEach(i => { updated[i] = { ...updated[i], uploadStatus: 'uploading' } })
      }
      return updated
    })

    const confirmedShipmentIds: string[] = []
    let totalFailed = 0
    let totalDuplicates = 0

    for (const [shipmentId, { rowIndexes, files }] of grouped) {
      try {
        const { data } = await shipmentsApi.bulkCcroUpload(shipmentId, files)

        // Compute flags directly from response data — NOT inside the setRows updater,
        // because React calls updaters lazily.
        const shipmentHadSuccess = data.results.some(
          r => r.status === 'created' || r.status === 'matched'
        )
        const shipmentFailed = data.results.filter(
          r => r.status !== 'created' && r.status !== 'matched'
        ).length
        totalFailed += shipmentFailed
        totalDuplicates += data.results.filter(r => r.status === 'duplicate').length

        setRows(prev => {
          const updated = [...prev]
          data.results.forEach((result, fi) => {
            const rowIdx = rowIndexes[fi]
            if (rowIdx === undefined) return
            if (result.status === 'created' || result.status === 'matched') {
              updated[rowIdx] = {
                ...updated[rowIdx],
                uploadStatus: 'done',
                uploadResult: result.status === 'created' ? 'Container added' : 'Container matched',
              }
            } else if (result.status === 'duplicate') {
              updated[rowIdx] = {
                ...updated[rowIdx],
                uploadStatus: 'duplicate',
                uploadResult: result.conflict_bl
                  ? `Already active on ${result.conflict_bl}`
                  : 'CCRO already uploaded for this container',
              }
            } else {
              updated[rowIdx] = {
                ...updated[rowIdx],
                uploadStatus: 'not_detected',
                uploadResult: 'Container not found in PDF',
              }
            }
          })
          return updated
        })

        if (shipmentHadSuccess) confirmedShipmentIds.push(shipmentId)
      } catch (err: unknown) {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        const message = typeof detail === 'string' ? detail : 'Upload failed'
        totalFailed += rowIndexes.length
        setRows(prev => {
          const updated = [...prev]
          rowIndexes.forEach(i => { updated[i] = { ...updated[i], uploadStatus: 'error', uploadResult: message } })
          return updated
        })
      }
    }

    setUploading(false)

    if (confirmedShipmentIds.length > 0) {
      // If any rows came back as failed/duplicate/undetected, defer confirm until user resolves them
      if (totalFailed > 0) {
        setPendingConfirm(confirmedShipmentIds)
      } else {
        await doConfirm(confirmedShipmentIds)
      }
    } else {
      if (totalFailed > 0 || totalDuplicates > 0) toast.error('All files were duplicates or failed')
    }
  }

  async function doConfirm(shipmentIds: string[]) {
    setConfirmingTransport(true)
    try {
      const { data } = await shipmentsApi.bulkConfirmCcro(shipmentIds)
      const skipped = data.skipped?.length ?? 0
      if (skipped > 0) {
        toast.success(`${data.confirmed} shipment${data.confirmed !== 1 ? 's' : ''} sent to Transport (${skipped} skipped — check missing CCROs or DO date)`)
      } else {
        toast.success(`${data.confirmed} shipment${data.confirmed !== 1 ? 's' : ''} sent to Transport · Transport & DC notified`)
        onDone()
        onClose()
      }
    } catch {
      toast.error('CCROs uploaded but could not confirm — use individual shipment view to send to Transport')
    } finally {
      setConfirmingTransport(false)
    }
  }

  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  function setManualMatch(idx: number, shipmentId: string, blNumber: string, containerCount: number | null) {
    setRows(prev => {
      const updated = [...prev]
      // Reset analyze-phase flags — they belonged to the old shipment. Server validates on upload.
      updated[idx] = { ...updated[idx], shipmentId, blNumber, containerCount, hasExistingDoc: false, conflictBl: null, hasActiveCcroTask: true }
      return updated
    })
  }

  // Build per-BL groups for summary display
  const blGroups = (() => {
    const map = new Map<string, { blNumber: string; containerCount: number | null; rows: RowState[] }>()
    for (const row of rows) {
      if (!row.shipmentId || row.analyzing) continue
      const key = row.shipmentId
      if (!map.has(key)) map.set(key, { blNumber: row.blNumber ?? '', containerCount: null, rows: [] })
      const group = map.get(key)!
      group.rows.push(row)
      // Use first non-null containerCount found (manual-match rows always have null)
      if (group.containerCount === null && row.containerCount !== null) {
        group.containerCount = row.containerCount
      }
    }
    return Array.from(map.values())
  })()

  const allAnalyzed = rows.length > 0 && rows.every(r => !r.analyzing)
  const existingDocCount = rows.filter(r => r.hasExistingDoc && r.uploadStatus === 'idle').length
  const conflictCount = rows.filter(r => r.conflictBl && r.uploadStatus === 'idle').length
  const noTaskCount = rows.filter(r => r.shipmentId && !r.hasActiveCcroTask && !r.hasExistingDoc && !r.conflictBl && r.uploadStatus === 'idle').length
  const readyCount = rows.filter(r => r.shipmentId && r.uploadStatus === 'idle' && !r.hasExistingDoc && !r.conflictBl && r.hasActiveCcroTask).length
  const pendingManual = rows.filter(r => !r.shipmentId && !r.analyzing && r.uploadStatus === 'idle').length
  const unresolvedCount = rows.filter(r => ['duplicate', 'error', 'not_detected'].includes(r.uploadStatus)).length
  const uniqueBLs = new Set(rows.filter(r => r.shipmentId && r.uploadStatus === 'idle' && !r.hasExistingDoc && !r.conflictBl && r.hasActiveCcroTask).map(r => r.blNumber)).size
  const isWorking = uploading || confirmingTransport
  const isSettledPhase = rows.some(r => r.uploadStatus !== 'idle' && r.uploadStatus !== 'uploading')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Bulk CCRO Upload</h2>
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
              {isDragActive ? 'Drop CCRO PDFs here' : 'Drop CCRO PDFs here, or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mt-1">PDF only · one file per container · multiple files supported</p>
          </div>

          {rows.length > 0 && (
            <div className="space-y-4">
              {/* Per-BL group summaries */}
              {allAnalyzed && blGroups.length > 0 && (
                <div className="space-y-2">
                  {blGroups.map(group => {
                    const uploaded = group.rows.filter(r => r.uploadStatus === 'done').length
                    const duplicate = group.rows.filter(r => r.uploadStatus === 'duplicate').length
                    const failed = group.rows.filter(r => r.uploadStatus === 'error' || r.uploadStatus === 'not_detected').length
                    const idle = group.rows.filter(r => r.uploadStatus === 'idle').length
                    const declared = group.containerCount
                    const missing = declared != null ? declared - group.rows.length : null

                    return (
                      <div
                        key={group.blNumber}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-4 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{group.blNumber}</span>
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            {declared != null && (
                              <span className="text-gray-500 dark:text-gray-400">{declared} declared</span>
                            )}
                            {isSettledPhase ? (
                              <>
                                {uploaded > 0 && <span className="text-green-600 dark:text-green-400 font-medium">{uploaded} uploaded</span>}
                                {duplicate > 0 && <span className="text-red-500 dark:text-red-400 font-medium">{duplicate} duplicate</span>}
                                {failed > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{failed} failed</span>}
                              </>
                            ) : (
                              <>
                                <span className="text-blue-600 dark:text-blue-400 font-medium">{idle} file{idle !== 1 ? 's' : ''} ready</span>
                                {missing != null && missing > 0 && (
                                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                                    <AlertTriangle size={11} />
                                    {missing} missing
                                  </span>
                                )}
                                {missing != null && missing < 0 && (
                                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                                    <AlertTriangle size={11} />
                                    {Math.abs(missing)} over declared
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* File rows */}
              <div className="space-y-2">
                {rows.map((row, idx) => (
                  <CcroFileRow
                    key={`${row.file.name}-${idx}`}
                    row={row}
                    onRemove={() => removeRow(idx)}
                    onMatch={(sid, bl, cc) => setManualMatch(idx, sid, bl, cc)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {rows.length === 0
                ? 'No files selected'
                : !allAnalyzed
                ? 'Analyzing files…'
                : confirmingTransport
                ? 'Sending to Transport…'
                : pendingConfirm.length > 0 && unresolvedCount > 0
                ? `Remove ${unresolvedCount} unresolved file${unresolvedCount !== 1 ? 's' : ''} to confirm`
                : conflictCount > 0
                ? `${conflictCount} file${conflictCount !== 1 ? 's' : ''} ${conflictCount !== 1 ? 'are' : 'is'} already active on another shipment — remove to continue`
                : noTaskCount > 0
                ? `${noTaskCount} file${noTaskCount !== 1 ? 's' : ''} ${noTaskCount !== 1 ? 'have' : 'has'} no active CCRO task — remove to continue`
                : existingDocCount > 0
                ? `${existingDocCount} file${existingDocCount !== 1 ? 's' : ''} already ${existingDocCount !== 1 ? 'have' : 'has'} a CCRO — remove to continue`
                : pendingManual > 0
                ? `${pendingManual} file${pendingManual !== 1 ? 's' : ''} need manual assignment — assign or remove before uploading`
                : `${readyCount} file${readyCount !== 1 ? 's' : ''} across ${uniqueBLs} BL${uniqueBLs !== 1 ? 's' : ''} ready`}
            </p>
            {allAnalyzed && readyCount > 0 && pendingConfirm.length === 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Transport &amp; DC will each receive one summary email
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            {pendingConfirm.length > 0 ? (
              <button
                onClick={() => doConfirm(pendingConfirm)}
                disabled={unresolvedCount > 0 || isWorking}
                className="px-4 py-2 text-sm rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isWorking && <Loader size={14} className="animate-spin" />}
                {confirmingTransport ? 'Sending to Transport…' : 'Confirm & Send to Transport'}
              </button>
            ) : (
              <button
                onClick={handleUpload}
                disabled={readyCount === 0 || isWorking || !allAnalyzed || pendingManual > 0 || existingDocCount > 0 || conflictCount > 0 || noTaskCount > 0}
                className="px-4 py-2 text-sm rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isWorking && <Loader size={14} className="animate-spin" />}
                {uploading ? 'Uploading…' : 'Upload & Send to Transport'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CcroFileRow({
  row,
  onRemove,
  onMatch,
}: {
  row: RowState
  onRemove: () => void
  onMatch: (shipmentId: string, blNumber: string, containerCount: number | null) => void
}) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ShipmentListItem[]>([])
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchInitial() {
    try {
      const { data } = await shipmentsApi.list({ limit: 10, my_queue: true, task_type_filter: 'CCRO' })
      setResults(data.items)
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
        const { data } = await shipmentsApi.list({ search: q, limit: 8, my_queue: true, task_type_filter: 'CCRO' })
        setResults(data.items)
      } catch {
        setResults([])
      }
    }, 300)
  }

  const statusIcon = () => {
    if (row.uploadStatus === 'done') return <CheckCircle size={16} className="text-green-500 shrink-0" />
    if (row.uploadStatus === 'error' || row.uploadStatus === 'duplicate') return <AlertCircle size={16} className="text-red-500 shrink-0" />
    if (row.uploadStatus === 'not_detected') return <AlertCircle size={16} className="text-orange-500 shrink-0" />
    if (row.uploadStatus === 'uploading') return <Loader size={16} className="animate-spin text-blue-500 shrink-0" />
    if (row.analyzing) return <Loader size={16} className="animate-spin text-gray-400 shrink-0" />
    if (row.hasExistingDoc) return <AlertCircle size={16} className="text-amber-500 shrink-0" />
    if (row.conflictBl) return <AlertCircle size={16} className="text-red-500 shrink-0" />
    if (row.shipmentId && !row.hasActiveCcroTask) return <AlertCircle size={16} className="text-red-500 shrink-0" />
    if (row.shipmentId) return <CheckCircle size={16} className="text-green-500 shrink-0" />
    return <AlertCircle size={16} className="text-amber-500 shrink-0" />
  }

  const isSettled = row.uploadStatus !== 'idle' && row.uploadStatus !== 'uploading'

  return (
    <div className={clsx(
      'rounded-lg border px-4 py-3 flex flex-col gap-2',
      row.uploadStatus === 'done'
        ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/10'
        : (row.uploadStatus === 'duplicate' || row.uploadStatus === 'error' || row.uploadStatus === 'not_detected')
        ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10'
        : row.hasExistingDoc
        ? 'border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/10'
        : (row.conflictBl || (row.shipmentId && !row.hasActiveCcroTask))
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
          title="View PDF"
          className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
        >
          <Eye size={14} />
        </button>
        {!isSettled && row.uploadStatus === 'idle' && (
          <button onClick={onRemove} className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Result after upload */}
      {isSettled && row.uploadResult && (
        <p className={clsx(
          'text-xs ml-7',
          row.uploadStatus === 'done' ? 'text-green-600 dark:text-green-400' :
          'text-red-600 dark:text-red-400',
        )}>
          {row.uploadResult}
        </p>
      )}

      {/* Badges before upload */}
      {!row.analyzing && row.uploadStatus === 'idle' && (
        row.shipmentId ? (
          <div className="flex flex-col gap-1.5 ml-7">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                {row.blNumber}
              </span>
              {row.detectedContainer && (
                <span className="text-xs font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                  {row.detectedContainer}
                </span>
              )}
              <button
                onClick={startSearching}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline"
              >
                change
              </button>
            </div>
            {row.hasExistingDoc && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ A CCRO already exists for this container — remove it from the list or delete the existing document first
              </p>
            )}
            {row.conflictBl && (
              <p className="text-xs text-red-600 dark:text-red-400">
                Container already active on {row.conflictBl} — remove this file
              </p>
            )}
            {!row.hasActiveCcroTask && !row.conflictBl && (
              <p className="text-xs text-red-600 dark:text-red-400">
                No active CCRO task on this shipment — remove this file
              </p>
            )}
          </div>
        ) : (
          <div className="ml-7">
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">
              {row.analysis?.detected_bl
                ? `Detected "${row.analysis.detected_bl}" — no matching shipment found`
                : 'Could not detect BL number'}
            </p>
            {row.detectedContainer && (
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                {row.detectedContainer}
              </span>
            )}
            {!searching && (
              <button
                onClick={startSearching}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 mt-1"
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
            placeholder="Search by BL number…"
            className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg max-h-40 overflow-y-auto">
              {results.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    onMatch(s.id, s.bl_number, null)
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
