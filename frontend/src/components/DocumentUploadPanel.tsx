import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, CheckCircle, FileText, AlertCircle, Loader, Scissors } from 'lucide-react'
import toast from 'react-hot-toast'
import { documentsApi, openDocument } from '@/api/documents'
import { CUSTOMER_REQUIRED_DOCS, DOC_TYPE_LABELS, DOC_TYPE_OPTIONAL_DOCS } from '@/types'
import type { Document, DocumentType } from '@/types'
import { formatFileSize } from '@/lib/dates'
import clsx from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { PDFSplitModal } from '@/components/PDFSplitModal'

interface Props {
  shipmentId: string
  documents: Document[]
  onUploaded: () => void
  readonly?: boolean
}

interface PendingFile {
  id: string
  file: File
  docType: DocumentType | ''
  detected: boolean
  userModified: boolean
}

function guessTypeFromName(filename: string): DocumentType | '' {
  const name = filename.toLowerCase()
  if (name.includes('invoice'))                                       return 'COMMERCIAL_INVOICE'
  if (name.includes('packing'))                                       return 'PACKING_LIST'
  if (name.includes('origin'))                                        return 'CERT_OF_ORIGIN'
  if (name.includes('halal'))                                         return 'HALAL_CERT'
  if (name.includes('bill of lading') || name.includes('bill_of_lading') || /(?<![a-z])bl(?![a-z])/.test(name)) return 'BL'
  if (name.includes('health'))                                        return 'HEALTH_CERT'
  return ''
}

export function DocumentUploadPanel({ shipmentId, documents, onUploaded, readonly }: Props) {
  const { user } = useAuth()
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [pending, setPending] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState<Set<string>>(new Set())
  const [detecting, setDetecting] = useState<Set<string>>(new Set())

  const isCustomer = user?.team === 'CUSTOMER'

  const combinedDoc = documents.find(d => d.doc_type === 'COMBINED_DOCS')
  const miscDoc = documents.find(d => d.doc_type === 'MISCELLANEOUS')

  // ── shared helpers ──────────────────────────────────────────────────────────

  async function deleteDocument(doc: Document) {
    try {
      await documentsApi.delete(doc.id)
      onUploaded()
      toast.success('Document removed')
    } catch {
      toast.error('Failed to remove document')
    }
  }

  async function downloadDocument(doc: Document) {
    try {
      const { data } = await documentsApi.getUrl(doc.id)
      const a = document.createElement('a')
      a.href = data.url
      a.click()
    } catch {
      toast.error('Failed to download')
    }
  }

  // ── CUSTOMER VIEW ────────────────────────────────────────────────────────────

  const onDropCustomer = useCallback((accepted: File[]) => {
    const newItems: PendingFile[] = accepted.map(file => ({
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      file,
      docType: '',
      detected: false,
      userModified: false,
    }))
    setPending(p => [...p, ...newItems])
  }, [])

  const { getRootProps: getCustomerRootProps, getInputProps: getCustomerInputProps, isDragActive: isCustomerDragActive } = useDropzone({
    onDrop: onDropCustomer,
    disabled: readonly,
    multiple: true,
    accept: { 'application/pdf': ['.pdf'], 'image/*': ['.jpg', '.jpeg', '.png'] },
  })

  async function uploadCustomerFile(id: string) {
    const item = pending.find(p => p.id === id)
    if (!item?.docType) { toast.error('Select a document type'); return }
    setUploading(s => new Set(s).add(id))
    try {
      await documentsApi.upload({ shipment_id: shipmentId, doc_type: item.docType as DocumentType, file: item.file })
      setPending(p => p.filter(p => p.id !== id))
      onUploaded()
      toast.success(`${DOC_TYPE_LABELS[item.docType as DocumentType]} uploaded`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  if (isCustomer) {
    const hasCombined = !!combinedDoc
    const uploadedIndividual = CUSTOMER_REQUIRED_DOCS.filter(t => documents.some(d => d.doc_type === t))
    const uploadedTypes = new Set(documents.filter(d => CUSTOMER_REQUIRED_DOCS.includes(d.doc_type)).map(d => d.doc_type))
    const completionCount = CUSTOMER_REQUIRED_DOCS.filter(t => uploadedTypes.has(t)).length
    const isComplete = completionCount === CUSTOMER_REQUIRED_DOCS.length

    return (
      <div className="space-y-4">
        {/* Progress */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Documents:{' '}
            <span className={clsx('font-bold', isComplete ? 'text-green-600' : completionCount > 0 ? 'text-amber-600' : 'text-amber-600')}>
              {completionCount} / {CUSTOMER_REQUIRED_DOCS.length}
            </span>
          </span>
          {isComplete && (
            <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
              <CheckCircle size={16} /> Ready to submit
            </span>
          )}
        </div>

        {/* 6 individual required doc slots */}
        {CUSTOMER_REQUIRED_DOCS.map(docType => {
          const doc = documents.find(d => d.doc_type === docType)
          return (
            <div key={docType} className={clsx(
              'flex items-center justify-between p-3 rounded-lg border',
              doc
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'
            )}>
              <div className="flex items-center gap-2">
                {doc
                  ? <CheckCircle size={18} className="text-green-500 shrink-0" />
                  : <AlertCircle size={18} className="text-gray-400 shrink-0" />}
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{DOC_TYPE_LABELS[docType]}</span>
                {doc && <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(doc.compressed_size_bytes)}</span>}
              </div>
              {doc ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => openDocument(doc.id)} className="text-xs text-blue-600 hover:underline">View</button>
                  <button onClick={() => downloadDocument(doc)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700">Download</button>
                  {!readonly && <button onClick={() => deleteDocument(doc)} className="text-xs text-red-500 hover:text-red-700"><X size={14} /></button>}
                </div>
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500">Not uploaded</span>
              )}
            </div>
          )
        })}

        {/* Miscellaneous slot */}
        <div className={clsx(
          'flex items-center justify-between p-3 rounded-lg border border-dashed',
          miscDoc
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : 'border-gray-300 dark:border-gray-600'
        )}>
          <div className="flex items-center gap-2">
            {miscDoc
              ? <CheckCircle size={18} className="text-green-500 shrink-0" />
              : <FileText size={18} className="text-gray-300 dark:text-gray-600 shrink-0" />}
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Miscellaneous</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 italic">optional</span>
            {miscDoc && <span className="text-xs text-gray-500">{formatFileSize(miscDoc.compressed_size_bytes)}</span>}
          </div>
          {miscDoc ? (
            <div className="flex items-center gap-2">
              <button onClick={() => openDocument(miscDoc.id)} className="text-xs text-blue-600 hover:underline">View</button>
              <button onClick={() => downloadDocument(miscDoc)} className="text-xs text-gray-500 hover:text-gray-700">Download</button>
              {!readonly && <button onClick={() => deleteDocument(miscDoc)} className="text-xs text-red-500 hover:text-red-700"><X size={14} /></button>}
            </div>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">Not uploaded</span>
          )}
        </div>

        {!readonly && (
          <>
            {/* Split PDF — primary upload path */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/10">
              <Scissors size={16} className="text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Have all your documents in one PDF?</p>
                <p className="text-xs text-blue-500 dark:text-blue-500">Upload it and assign each page range to the correct document type</p>
              </div>
              <button
                onClick={() => setShowSplitModal(true)}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 font-medium shrink-0"
              >
                Split PDF
              </button>
            </div>

            {/* Manual individual upload */}
            <div
              {...getCustomerRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
                isCustomerDragActive
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              )}
            >
              <input {...getCustomerInputProps()} />
              <Upload size={20} className="mx-auto mb-1 text-gray-400" />
              <p className="text-xs text-gray-500 dark:text-gray-400">Or upload individual documents — PDF, JPG, PNG</p>
            </div>

            {pending.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm and upload:</p>
                {pending.map(item => {
                  const isUploading = uploading.has(item.id)
                  return (
                    <div key={item.id} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-lg">
                      <FileText size={16} className="text-gray-400 shrink-0" />
                      <span className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1 min-w-0">{item.file.name}</span>
                      <select
                        value={item.docType}
                        onChange={e => setPending(p => p.map(x => x.id === item.id ? { ...x, docType: e.target.value as DocumentType, userModified: true } : x))}
                        disabled={isUploading}
                        className="text-xs border dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-600 text-gray-900 dark:text-white disabled:opacity-50"
                      >
                        <option value="">Select type…</option>
                        {CUSTOMER_REQUIRED_DOCS.map(t => {
                          const taken = uploadedTypes.has(t)
                          return (
                            <option key={t} value={t} disabled={taken}>
                              {DOC_TYPE_LABELS[t]}{taken ? ' ✓' : ''}
                            </option>
                          )
                        })}
                        <option value="MISCELLANEOUS">Miscellaneous</option>
                      </select>
                      <button
                        onClick={() => uploadCustomerFile(item.id)}
                        disabled={!item.docType || isUploading}
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 shrink-0"
                      >
                        {isUploading ? 'Uploading…' : 'Upload'}
                      </button>
                      <button onClick={() => setPending(p => p.filter(x => x.id !== item.id))} disabled={isUploading} className="text-gray-400 hover:text-red-500 shrink-0 disabled:opacity-30">
                        <X size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {showSplitModal && (
          <PDFSplitModal
            shipmentId={shipmentId}
            combinedDocId={combinedDoc?.id}
            existingDocs={documents}
            onSuccess={onUploaded}
            onClose={() => setShowSplitModal(false)}
          />
        )}
      </div>
    )
  }

  // ── INTERNAL / FF TEAM VIEW ──────────────────────────────────────────────────

  const onDrop = useCallback((accepted: File[]) => {
    const newItems: PendingFile[] = accepted.map(file => ({
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      file,
      docType: guessTypeFromName(file.name),
      detected: false,
      userModified: false,
    }))
    setPending(p => [...p, ...newItems])

    for (const item of newItems) {
      const isPdf = item.file.type === 'application/pdf' || item.file.name.toLowerCase().endsWith('.pdf')
      if (!isPdf) continue
      setDetecting(s => new Set(s).add(item.id))
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      documentsApi.detectType(item.file, controller.signal)
        .then(({ data }) => {
          if (data.doc_type) {
            setPending(p => p.map(p =>
              p.id === item.id && !p.userModified ? { ...p, docType: data.doc_type as DocumentType, detected: true } : p
            ))
          }
        })
        .catch(() => {})
        .finally(() => { clearTimeout(timeout); setDetecting(s => { const n = new Set(s); n.delete(item.id); return n }) })
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: readonly,
    multiple: true,
    accept: { 'application/pdf': ['.pdf'], 'image/*': ['.jpg', '.jpeg', '.png'] },
  })

  async function uploadFile(id: string) {
    const item = pending.find(p => p.id === id)
    if (!item?.docType) { toast.error('Please select a document type'); return }
    setUploading(s => new Set(s).add(id))
    try {
      await documentsApi.upload({ shipment_id: shipmentId, doc_type: item.docType as DocumentType, file: item.file })
      setPending(p => p.filter(p => p.id !== id))
      onUploaded()
      toast.success(`${DOC_TYPE_LABELS[item.docType as DocumentType]} uploaded`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  async function uploadAll() {
    const ready = pending.filter(item => item.docType && !uploading.has(item.id))
    if (ready.length === 0) return
    setUploading(s => { const n = new Set(s); ready.forEach(item => n.add(item.id)); return n })
    const results = await Promise.allSettled(
      ready.map(async item => {
        await documentsApi.upload({ shipment_id: shipmentId, doc_type: item.docType as DocumentType, file: item.file })
        return item.id
      })
    )
    const succeeded = new Set(results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map(r => r.value))
    const failedCount = results.filter(r => r.status === 'rejected').length
    setPending(p => p.filter(item => !succeeded.has(item.id)))
    setUploading(new Set())
    if (succeeded.size > 0) { onUploaded(); toast.success(`${succeeded.size} document${succeeded.size !== 1 ? 's' : ''} uploaded`) }
    if (failedCount > 0) toast.error(`${failedCount} upload${failedCount !== 1 ? 's' : ''} failed`)
  }

  const uploadedTypes = new Set(documents.filter(d => CUSTOMER_REQUIRED_DOCS.includes(d.doc_type)).map(d => d.doc_type))
  const completionCount = CUSTOMER_REQUIRED_DOCS.filter(t => uploadedTypes.has(t)).length
  const isComplete = completionCount === CUSTOMER_REQUIRED_DOCS.length
  const readyCount = pending.filter(p => p.docType).length

  return (
    <div className="space-y-4">

      {/* Customer's original combined upload */}
      {combinedDoc && (
        <div className="flex items-center justify-between p-3 rounded-lg border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={18} className="text-blue-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Original Combined Upload</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(combinedDoc.compressed_size_bytes)} — submitted by customer</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => openDocument(combinedDoc.id)} className="text-xs text-blue-600 hover:underline">View</button>
            <button onClick={() => downloadDocument(combinedDoc)} className="text-xs text-gray-500 hover:text-gray-700">Download</button>
            <button onClick={() => deleteDocument(combinedDoc)} className="text-xs text-red-500 hover:text-red-700"><X size={14} /></button>
          </div>
        </div>
      )}

      {/* Split progress */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Split documents: <span className={clsx('font-bold', isComplete ? 'text-green-600' : 'text-amber-600')}>{completionCount} / {CUSTOMER_REQUIRED_DOCS.length}</span>
        </span>
        {isComplete && <span className="flex items-center gap-1 text-green-600 text-sm font-medium"><CheckCircle size={16} /> All documents ready</span>}
      </div>

      {/* 6 individual required doc slots */}
      <div className="grid grid-cols-1 gap-2">
        {CUSTOMER_REQUIRED_DOCS.map(docType => {
          const doc = documents.find(d => d.doc_type === docType)
          return (
            <div key={docType} className={clsx('flex items-center justify-between p-3 rounded-lg border', doc ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600')}>
              <div className="flex items-center gap-2">
                {doc ? <CheckCircle size={18} className="text-green-500 shrink-0" /> : <AlertCircle size={18} className="text-gray-400 shrink-0" />}
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{DOC_TYPE_LABELS[docType]}</span>
                {doc && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatFileSize(doc.compressed_size_bytes)}
                    {doc.original_size_bytes !== doc.compressed_size_bytes && (
                      <span className="text-green-600 ml-1">({Math.round((1 - doc.compressed_size_bytes / doc.original_size_bytes) * 100)}% smaller)</span>
                    )}
                  </span>
                )}
              </div>
              {doc ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => openDocument(doc.id)} className="text-xs text-blue-600 hover:underline">View</button>
                  <button onClick={() => downloadDocument(doc)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700">Download</button>
                  <button onClick={() => deleteDocument(doc)} className="text-xs text-red-500 hover:text-red-700"><X size={14} /></button>
                </div>
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500">Not split yet</span>
              )}
            </div>
          )
        })}

        {/* Miscellaneous */}
        {DOC_TYPE_OPTIONAL_DOCS.map(docType => {
          const doc = documents.find(d => d.doc_type === docType)
          return (
            <div key={docType} className={clsx('flex items-center justify-between p-3 rounded-lg border border-dashed', doc ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'border-gray-300 dark:border-gray-600')}>
              <div className="flex items-center gap-2">
                {doc ? <CheckCircle size={18} className="text-green-500 shrink-0" /> : <FileText size={18} className="text-gray-300 dark:text-gray-600 shrink-0" />}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{DOC_TYPE_LABELS[docType]}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 italic">optional</span>
                {doc && <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(doc.compressed_size_bytes)}</span>}
              </div>
              {doc ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => openDocument(doc.id)} className="text-xs text-blue-600 hover:underline">View</button>
                  <button onClick={() => downloadDocument(doc)} className="text-xs text-gray-500 hover:text-gray-700">Download</button>
                  <button onClick={() => deleteDocument(doc)} className="text-xs text-red-500 hover:text-red-700"><X size={14} /></button>
                </div>
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500">Not uploaded</span>
              )}
            </div>
          )
        })}
      </div>


      {showSplitModal && (
        <PDFSplitModal
          shipmentId={shipmentId}
          combinedDocId={combinedDoc?.id}
          existingDocs={documents}
          onSuccess={onUploaded}
          onClose={() => setShowSplitModal(false)}
        />
      )}

      {/* Manual upload (for individual docs the internal team may need to add) */}
      {!readonly && (
        <>
          <div
            {...getRootProps()}
            className={clsx(
              'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
              isDragActive ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
            )}
          >
            <input {...getInputProps()} />
            <Upload size={20} className="mx-auto mb-1 text-gray-400" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Or manually upload individual documents — PDF, JPG, PNG</p>
          </div>

          {pending.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm type and upload:</p>
                <button onClick={uploadAll} disabled={uploading.size > 0 || readyCount === 0} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                  {uploading.size > 0 ? 'Uploading…' : `Upload All (${readyCount})`}
                </button>
              </div>
              {pending.map(item => {
                const isDetecting = detecting.has(item.id)
                const isUploading = uploading.has(item.id)
                const takenTypes = new Set(pending.filter(p => p.id !== item.id && p.docType).map(p => p.docType))
                return (
                  <div key={item.id} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-lg">
                    <FileText size={16} className="text-gray-400 shrink-0" />
                    <span className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1 min-w-0">{item.file.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isDetecting && <span className="flex items-center gap-1 text-xs text-gray-400"><Loader size={11} className="animate-spin" /> Detecting…</span>}
                      {!isDetecting && item.detected && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">✓ detected</span>}
                      <select
                        value={item.docType}
                        onChange={e => setPending(p => p.map(x => x.id === item.id ? { ...x, docType: e.target.value as DocumentType, detected: false, userModified: true } : x))}
                        disabled={isUploading}
                        className="text-xs border dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-600 text-gray-900 dark:text-white disabled:opacity-50"
                      >
                        <option value="">Select type…</option>
                        {CUSTOMER_REQUIRED_DOCS.map(t => {
                          const takenByUpload = uploadedTypes.has(t)
                          const takenByPending = takenTypes.has(t)
                          const disabled = (takenByUpload || takenByPending) && item.docType !== t
                          return (
                            <option key={t} value={t} disabled={disabled}>
                              {DOC_TYPE_LABELS[t]}{takenByUpload ? ' ✓' : takenByPending ? ' (selected)' : ''}
                            </option>
                          )
                        })}
                        {DOC_TYPE_OPTIONAL_DOCS.map(t => (
                          <option key={t} value={t}>{DOC_TYPE_LABELS[t]} (optional)</option>
                        ))}
                      </select>
                    </div>
                    <button onClick={() => uploadFile(item.id)} disabled={!item.docType || isUploading} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 shrink-0">
                      {isUploading ? 'Uploading…' : 'Upload'}
                    </button>
                    <button onClick={() => setPending(p => p.filter(x => x.id !== item.id))} disabled={isUploading} className="text-gray-400 hover:text-red-500 shrink-0 disabled:opacity-30">
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
