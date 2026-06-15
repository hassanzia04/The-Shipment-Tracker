import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { X, Upload, FileText, Loader, Scissors, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { documentsApi } from '@/api/documents'
import { CUSTOMER_REQUIRED_DOCS, DOC_TYPE_LABELS } from '@/types'
import type { Document, DocumentType } from '@/types'

interface Props {
  shipmentId: string
  combinedDocId?: string
  existingDocs?: Document[]
  onSuccess: () => void
  onClose: () => void
}

type PageRanges = Partial<Record<DocumentType, string>>

function parseRange(input: string): number[] | null {
  if (!input.trim()) return null
  const pages = new Set<number>()
  const parts = input.split(',').map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(s => parseInt(s, 10))
      if (isNaN(a) || isNaN(b) || a < 1 || b < a) return null
      for (let i = a; i <= b; i++) pages.add(i - 1)
    } else {
      const n = parseInt(part, 10)
      if (isNaN(n) || n < 1) return null
      pages.add(n - 1)
    }
  }
  return pages.size > 0 ? [...pages].sort((a, b) => a - b) : null
}

export function PDFSplitModal({ shipmentId, combinedDocId, existingDocs, onSuccess, onClose }: Props) {
  const remainingDocTypes = CUSTOMER_REQUIRED_DOCS.filter(
    t => !existingDocs?.some(d => d.doc_type === t)
  )
  const [file, setFile] = useState<File | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [ranges, setRanges] = useState<PageRanges>({})
  const [submitting, setSubmitting] = useState(false)
  const [detecting, setDetecting] = useState(false)

  // Auto-load the combined doc via API (as a blob URL) when a combinedDocId is provided
  useEffect(() => {
    if (!combinedDocId) return
    let cancelled = false
    setLoadingPreview(true)
    documentsApi.getContent(combinedDocId)
      .then(({ data }) => {
        if (!cancelled) {
          const url = URL.createObjectURL(data as Blob)
          setPdfUrl(url)
        }
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load the combined PDF preview')
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })
    return () => { cancelled = true }
  }, [combinedDocId])

  useEffect(() => {
    return () => {
      // Only revoke blob URLs (not OCI URLs)
      if (pdfUrl && pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0]
    if (!f) return
    setPdfUrl(prev => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      const blob = f.type === 'application/pdf' ? f : new Blob([f], { type: 'application/pdf' })
      return URL.createObjectURL(blob)
    })
    setFile(f)
    setRanges({})
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
  })

  function updateRange(docType: DocumentType, value: string) {
    setRanges(r => ({ ...r, [docType]: value }))
  }

  function clearFile() {
    setFile(null)
    setPdfUrl(prev => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      // If there's a combinedDocId, reload the OCI preview
      return null
    })
    setRanges({})
    if (combinedDocId) {
      setLoadingPreview(true)
      documentsApi.getContent(combinedDocId)
        .then(({ data }) => setPdfUrl(URL.createObjectURL(data as Blob)))
        .catch(() => toast.error('Could not reload the combined PDF preview'))
        .finally(() => setLoadingPreview(false))
    }
  }

  const hasPreview = pdfUrl !== null
  const showDropzone = !hasPreview && !loadingPreview

  async function handleAutoDetect() {
    setDetecting(true)
    try {
      const { data } = await documentsApi.aiDetectSplits(
        combinedDocId && !file
          ? { sourceDocumentId: combinedDocId }
          : { file: file! }
      )
      const newRanges: PageRanges = {}
      for (const item of data) {
        if (remainingDocTypes.includes(item.doc_type as DocumentType)) {
          newRanges[item.doc_type as DocumentType] = item.pages
        }
      }
      setRanges(newRanges)
      toast.success('Page assignments detected — please review before uploading')
    } catch {
      toast.error('Auto-detect failed — please assign pages manually')
    } finally {
      setDetecting(false)
    }
  }

  async function handleSubmit() {
    if (!hasPreview) return

    if (remainingDocTypes.length === 0) {
      toast.error('All documents are already uploaded individually — nothing to split')
      return
    }

    const segments: Array<{ doc_type: DocumentType; pages: number[] }> = []
    for (const docType of remainingDocTypes) {
      const raw = ranges[docType]?.trim()
      if (!raw) {
        toast.error(`${DOC_TYPE_LABELS[docType]}: page range is required`)
        return
      }
      const pages = parseRange(raw)
      if (!pages) {
        toast.error(`${DOC_TYPE_LABELS[docType]}: invalid range "${raw}" — use format like 1-3 or 2,4`)
        return
      }
      segments.push({ doc_type: docType, pages })
    }

    setSubmitting(true)
    try {
      if (combinedDocId && !file) {
        // Use OCI-based split — no re-upload needed
        await documentsApi.splitByDocument({ source_document_id: combinedDocId, shipment_id: shipmentId, segments })
      } else if (file) {
        await documentsApi.splitUpload({ shipment_id: shipmentId, file, segments })
      } else {
        toast.error('No PDF available to split')
        return
      }
      toast.success(`${segments.length} documents extracted and uploaded`)
      onSuccess()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Split upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl min-h-[70vh] max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={17} className="text-blue-600" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Split PDF Upload</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        {loadingPreview ? (
          <div className="flex-1 flex items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
            <Loader size={20} className="animate-spin" />
            <span className="text-sm">Loading combined PDF…</span>
          </div>
        ) : showDropzone ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer w-full max-w-md transition-colors ${
                isDragActive
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <input {...getInputProps()} />
              <Upload size={32} className="mx-auto mb-3 text-gray-400" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drop the combined PDF here</p>
              <p className="text-xs text-gray-400 mt-1">PDF files only — all documents in one file</p>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center max-w-sm">
              After uploading, you'll assign which pages belong to each document type. The system will split and store them individually.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">

            {/* PDF Viewer */}
            <div className="flex-1 flex flex-col min-w-0 border-r dark:border-gray-700">
              <div className="px-4 py-2 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center gap-2 shrink-0">
                <FileText size={13} className="text-gray-500 shrink-0" />
                <span className="text-xs text-gray-600 dark:text-gray-300 truncate">
                  {file ? file.name : 'Combined PDF (auto-loaded)'}
                </span>
                {!combinedDocId && (
                  <button onClick={clearFile} className="ml-auto text-xs text-blue-600 hover:underline shrink-0">
                    Change file
                  </button>
                )}
                {combinedDocId && file && (
                  <button onClick={clearFile} className="ml-auto text-xs text-blue-600 hover:underline shrink-0">
                    Use original
                  </button>
                )}
                {combinedDocId && !file && (
                  <div {...getRootProps()} className="ml-auto shrink-0">
                    <input {...getInputProps()} />
                    <button className="text-xs text-gray-400 hover:text-blue-600">
                      Replace file
                    </button>
                  </div>
                )}
              </div>
              <iframe
                src={pdfUrl!}
                className="flex-1 w-full"
                title="PDF Preview"
              />
            </div>

            {/* Page range panel */}
            <div className="w-72 shrink-0 flex flex-col">
              <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Assign pages per document</p>
                  {/* Auto-detect hidden — planned for future release */}
                  {false && (
                    <button
                      onClick={handleAutoDetect}
                      disabled={detecting || submitting}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors shrink-0"
                    >
                      {detecting
                        ? <Loader size={11} className="animate-spin" />
                        : <Sparkles size={11} />}
                      {detecting ? 'Detecting…' : 'Auto-detect'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Use <span className="font-mono">1-3</span> for ranges or <span className="font-mono">2,4,6</span> for individual pages
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {remainingDocTypes.length === 0 ? (
                  <p className="text-xs text-green-600 dark:text-green-400 text-center py-4">All documents already uploaded individually.</p>
                ) : null}
                {remainingDocTypes.map(docType => {
                  const value = ranges[docType] ?? ''
                  const isValid = value.trim() !== '' && parseRange(value) !== null
                  const hasInput = value.trim() !== ''
                  return (
                    <div key={docType}>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {DOC_TYPE_LABELS[docType]}
                      </label>
                      <input
                        type="text"
                        value={value}
                        onChange={e => updateRange(docType, e.target.value)}
                        placeholder="e.g. 1-2"
                        className={`w-full text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                          hasInput && !isValid
                            ? 'border-red-400 dark:border-red-500'
                            : isValid
                            ? 'border-green-400 dark:border-green-600'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                      />
                      {hasInput && !isValid && (
                        <p className="text-xs text-red-500 mt-0.5">Invalid format</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t dark:border-gray-700 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasPreview || submitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            {submitting && <Loader size={14} className="animate-spin" />}
            {submitting ? 'Uploading…' : 'Split & Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
