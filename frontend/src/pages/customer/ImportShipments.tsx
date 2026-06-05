import { useState, useCallback } from 'react'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { shipmentsApi } from '@/api/shipments'
import { documentsApi } from '@/api/documents'
import { DocumentUploadPanel } from '@/components/DocumentUploadPanel'
import { CUSTOMER_REQUIRED_DOCS } from '@/types'
import type { Document } from '@/types'
import { formatDate } from '@/lib/dates'
import { Download, Upload, ChevronDown, ChevronUp, CheckCircle, AlertCircle, ArrowUp, ArrowDown, ArrowUpDown, X, Info } from 'lucide-react'
import { useSortable } from '@/lib/sort'
import clsx from 'clsx'

interface ImportResult {
  inserted: number
  skipped: number
  errors: string[]
}

export function ImportShipments() {
  const qc = useQueryClient()
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [submittingAll, setSubmittingAll] = useState(false)
  const [remarks, setRemarks] = useState<Record<string, string>>({})

  // All customer-stage shipments belonging to this user
  const { data: listData, isLoading } = useQuery({
    queryKey: ['shipments', 'my-active'],
    queryFn: () => shipmentsApi.list({ stage: 'CUSTOMER', limit: 200 }).then(r => r.data),
  })
  const rawShipments = listData?.items ?? []

  const { sorted: shipments, sort: shipSort, toggle: shipToggle } = useSortable(rawShipments, (s, col) => {
    switch (col) {
      case 'bl':       return s.bl_number
      case 'invoice':  return s.invoice_number
      case 'pull_out': return s.pull_out_date
      case 'location': return s.offloading_point_name
      default:         return null
    }
  })

  // Fetch documents for every shipment in parallel so counts show immediately
  const docQueries = useQueries({
    queries: shipments.map(s => ({
      queryKey: ['documents', s.id],
      queryFn: () => documentsApi.list(s.id).then(r => r.data),
      staleTime: 30_000,
    })),
  })
  const docsMap: Record<string, Document[]> = Object.fromEntries(
    shipments.map((s, i) => [s.id, docQueries[i].data ?? []])
  )

  // ── template download ──────────────────────────────────────────────────────
  async function downloadTemplate() {
    try {
      const { data } = await shipmentsApi.importTemplate()
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'shipments_template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download template')
    }
  }

  // ── Excel import ───────────────────────────────────────────────────────────
  async function handleImport(file: File) {
    setImporting(true)
    setImportResult(null)
    try {
      const { data } = await shipmentsApi.importExcel(file)
      setImportResult(data)
      if (data.inserted > 0) {
        qc.invalidateQueries({ queryKey: ['shipments', 'my-active'] })
        qc.invalidateQueries({ queryKey: ['shipments'] })
        toast.success(`${data.inserted} shipment${data.inserted !== 1 ? 's' : ''} imported`)
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) handleImport(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    maxFiles: 1,
    disabled: importing,
  })

  // ── submit a single shipment ───────────────────────────────────────────────
  async function submitShipment(id: string, remark?: string) {
    setSubmitting(id)
    try {
      await shipmentsApi.submit(id, remark)
      toast.success('Submitted for FFD review')
      qc.invalidateQueries({ queryKey: ['shipments', 'my-active'] })
      qc.invalidateQueries({ queryKey: ['shipments'] })
      if (expanded === id) setExpanded(null)
      setRemarks(r => { const next = { ...r }; delete next[id]; return next })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Submission failed')
    } finally {
      setSubmitting(null)
    }
  }

  // ── submit all complete shipments at once ──────────────────────────────────
  async function submitAll(readyIds: string[]) {
    setSubmittingAll(true)
    const results = await Promise.allSettled(readyIds.map(id => shipmentsApi.submit(id)))
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    if (succeeded > 0) {
      toast.success(`${succeeded} shipment${succeeded !== 1 ? 's' : ''} submitted for FFD review`)
      qc.invalidateQueries({ queryKey: ['shipments', 'my-active'] })
      qc.invalidateQueries({ queryKey: ['shipments'] })
      setExpanded(null)
    }
    if (failed > 0) toast.error(`${failed} submission${failed !== 1 ? 's' : ''} failed`)
    setSubmittingAll(false)
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Shipments</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Import a batch of B/Ls from Excel, upload documents for each, then submit for FFD review.
        </p>
      </div>

      {/* ── Import section ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Import from Excel</h2>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-xs border dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={13} /> Download Template
          </button>
        </div>

        <div
          {...getRootProps()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
            isDragActive
              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700/30',
            importing && 'opacity-50 pointer-events-none'
          )}
        >
          <input {...getInputProps()} />
          <Upload size={28} className={clsx('mx-auto mb-3', isDragActive ? 'text-blue-500' : 'text-gray-400')} />
          {importing ? (
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Importing…</p>
          ) : isDragActive ? (
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Drop your Excel file here</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <span className="font-medium text-blue-600 dark:text-blue-400">Click to select</span> or drag and drop your Excel file
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                .xlsx only · multiple B/Ls in one file · existing BL numbers are skipped
              </p>
            </>
          )}
        </div>

        {/* Import result panel */}
        {importResult && (
          <div className="space-y-2">
            {/* Summary row */}
            <div className="flex items-center gap-3 flex-wrap">
              {importResult.inserted > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-full">
                  <CheckCircle size={13} /> {importResult.inserted} row{importResult.inserted !== 1 ? 's' : ''} imported
                </span>
              )}
              {importResult.skipped > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-full">
                  <Info size={13} /> {importResult.skipped} skipped — BL already exists
                </span>
              )}
              {importResult.errors.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-full">
                  <AlertCircle size={13} /> {importResult.errors.length} row{importResult.errors.length !== 1 ? 's' : ''} rejected
                </span>
              )}
              {importResult.inserted === 0 && importResult.skipped === 0 && importResult.errors.length === 0 && (
                <span className="text-xs text-gray-400 dark:text-gray-500">No data rows found in the file.</span>
              )}
              <button onClick={() => setImportResult(null)} className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={14} />
              </button>
            </div>

            {/* Error detail list */}
            {importResult.errors.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-1.5 max-h-48 overflow-y-auto">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
                  The following rows were not imported. Fix the issues in Masters then re-upload:
                </p>
                {importResult.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">• {err}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Shipments table ─────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b dark:border-gray-700 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">
            Pending Submission
            {shipments.length > 0 && (
              <span className="ml-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                {shipments.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            {(() => {
              const readyIds = shipments.filter(s => {
                const docs = docsMap[s.id] ?? []
                return docs.filter(d => CUSTOMER_REQUIRED_DOCS.includes(d.doc_type)).length === CUSTOMER_REQUIRED_DOCS.length
              }).map(s => s.id)
              return readyIds.length > 1 ? (
                <button
                  onClick={() => submitAll(readyIds)}
                  disabled={submittingAll || !!submitting}
                  className="flex items-center gap-1.5 text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  <CheckCircle size={13} />
                  {submittingAll ? 'Submitting…' : `Submit All Ready (${readyIds.length})`}
                </button>
              ) : null
            })()}
            <a href="/shipments/new" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              + Add single B/L manually
            </a>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(n => <div key={n} className="h-12 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}
          </div>
        ) : shipments.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No pending shipments.</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Import an Excel file above or add a B/L manually.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <>
            {/* Table header */}
            {(() => {
              const hd = (label: string, col: string) => {
                const active = shipSort.column === col
                return (
                  <button
                    onClick={() => shipToggle(col)}
                    className="flex items-center gap-1 text-left hover:text-gray-700 dark:hover:text-gray-200 transition-colors group"
                  >
                    {label}
                    <span className={clsx('transition-opacity', active ? 'opacity-100' : 'opacity-30 group-hover:opacity-60')}>
                      {active ? (shipSort.dir === 'asc' ? <ArrowUp size={10} className="text-blue-500" /> : <ArrowDown size={10} className="text-blue-500" />) : <ArrowUpDown size={10} />}
                    </span>
                  </button>
                )
              }
              return (
                <div className="grid grid-cols-[2fr_1.5fr_1fr_1.2fr_auto_auto] gap-4 px-5 py-2.5 bg-gray-50 dark:bg-gray-900/30 border-b dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide min-w-[560px]">
                  {hd('BL Number',    'bl')}
                  {hd('Invoice',      'invoice')}
                  {hd('Pull-out Date','pull_out')}
                  {hd('DC Location',  'location')}
                  <span>Documents</span>
                  <span></span>
                </div>
              )
            })()}

            {shipments.map(s => {
              const docs = docsMap[s.id] ?? []
              const customerDocs = docs.filter(d => CUSTOMER_REQUIRED_DOCS.includes(d.doc_type))
              const count = customerDocs.length
              const isComplete = count === CUSTOMER_REQUIRED_DOCS.length
              const isExpanded = expanded === s.id
              const isSubmitting = submitting === s.id || submittingAll
              const docsLoading = docQueries[shipments.indexOf(s)]?.isLoading

              return (
                <div key={s.id} className="border-b dark:border-gray-700 last:border-0">
                  {/* Main row */}
                  <div
                    className="grid grid-cols-[2fr_1.5fr_1fr_1.2fr_auto_auto] gap-4 px-5 py-3.5 items-center hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer min-w-[560px]"
                    onClick={() => setExpanded(isExpanded ? null : s.id)}
                  >
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{s.bl_number}</span>
                    <span className="text-sm text-gray-600 dark:text-gray-300 truncate">{s.invoice_number}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{s.pull_out_date ? formatDate(s.pull_out_date) : '—'}</span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{s.offloading_point_name ?? <span className="text-gray-400 dark:text-gray-500 italic">—</span>}</span>

                    {/* Doc count badge */}
                    <span
                      className={clsx(
                        'flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
                        docsLoading
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                          : isComplete
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : count > 0
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      )}
                    >
                      {isComplete
                        ? <><CheckCircle size={12} /> 6 / 6</>
                        : docsLoading
                        ? '…'
                        : <><AlertCircle size={12} /> {count} / 6</>
                      }
                    </span>

                    {/* Actions */}
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      {isComplete && (
                        <button
                          onClick={() => submitShipment(s.id)}
                          disabled={isSubmitting}
                          className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                        >
                          {isSubmitting ? 'Submitting…' : 'Submit'}
                        </button>
                      )}
                      <button className="text-gray-400 dark:text-gray-500">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded document upload panel */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 bg-gray-50 dark:bg-gray-800/50 border-t dark:border-gray-700">
                      <DocumentUploadPanel
                        shipmentId={s.id}
                        documents={docs}
                        onUploaded={() => {
                          qc.invalidateQueries({ queryKey: ['documents', s.id] })
                        }}
                        readonly={false}
                      />
                      {isComplete && (
                        <div className="mt-4 pt-4 border-t dark:border-gray-700 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Remarks for FFD team <span className="font-normal text-gray-400">(optional)</span></label>
                            <textarea
                              value={remarks[s.id] ?? ''}
                              onChange={e => setRemarks(r => ({ ...r, [s.id]: e.target.value }))}
                              rows={2}
                              placeholder="Any notes or context for the FFD team…"
                              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            />
                          </div>
                          <div>
                            <button
                              onClick={() => submitShipment(s.id, remarks[s.id]?.trim() || undefined)}
                              disabled={isSubmitting}
                              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                            >
                              {isSubmitting ? 'Submitting…' : 'Submit for Review'}
                            </button>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">All 6 documents uploaded — ready to submit to the FFD team.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Submitted shipments appear in your <a href="/shipments" className="text-blue-500 hover:underline">Shipments list</a>.
      </p>
    </div>
  )
}
