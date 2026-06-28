import { useState, useEffect } from 'react'
import { X, Download, Loader2, FileDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { documentsApi } from '@/api/documents'
import { DOC_TYPE_LABELS } from '@/types'
import type { DocumentType } from '@/types'

const DOC_GROUPS: { label: string; types: DocumentType[] }[] = [
  {
    label: 'Customer Documents',
    types: ['BL', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'CERT_OF_ORIGIN', 'HALAL_CERT', 'HEALTH_CERT'],
  },
  {
    label: 'Process Documents',
    types: ['PERMIT', 'BAYAN', 'DO', 'CCRO'],
  },
  {
    label: 'DC Documents',
    types: ['DN', 'DC_HEALTH_CERT'],
  },
  {
    label: 'Other',
    types: ['COMBINED_DOCS', 'MISCELLANEOUS'],
  },
]

interface ShipmentInfo {
  shipment_id: string
  bl_number: string
}

interface Props {
  selectedIds: string[]
  onClose: () => void
}

export function BulkDownloadModal({ selectedIds, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [byType, setByType] = useState<Record<string, ShipmentInfo[]>>({})
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [groupBy, setGroupBy] = useState<'shipment' | 'doc_type'>('shipment')
  const [downloading, setDownloading] = useState(false)

  const totalShipments = selectedIds.length
  const availableTypes = Object.keys(byType)

  useEffect(() => {
    documentsApi.getAvailableTypes(selectedIds)
      .then(({ data }) => {
        setByType(data.by_type)
        setSelectedTypes(new Set(Object.keys(data.by_type)))
      })
      .catch(() => {
        toast.error('Failed to load available document types')
        onClose()
      })
      .finally(() => setLoading(false))
  }, [])

  function toggleType(type: string) {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
  }

  function toggleAll() {
    setSelectedTypes(prev =>
      prev.size === availableTypes.length ? new Set() : new Set(availableTypes)
    )
  }

  async function handleDownload() {
    if (selectedTypes.size === 0) return
    setDownloading(true)
    try {
      const { data } = await documentsApi.bulkDownload(selectedIds, Array.from(selectedTypes), groupBy)
      const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `bulk_documents_${totalShipments}_shipments.zip`
      a.click()
      URL.revokeObjectURL(url)

      // Warn about shipments missing documents for selected types
      const missing: string[] = []
      for (const type of selectedTypes) {
        const present = new Set((byType[type] ?? []).map(s => s.shipment_id))
        const missingCount = selectedIds.filter(id => !present.has(id)).length
        if (missingCount > 0) {
          const label = DOC_TYPE_LABELS[type as DocumentType] ?? type
          missing.push(`${label}: missing for ${missingCount} shipment${missingCount > 1 ? 's' : ''}`)
        }
      }
      if (missing.length > 0) {
        toast(`Some documents were not available:\n${missing.join('\n')}`, { duration: 7000, icon: '⚠️' })
      } else {
        toast.success('Download complete')
      }
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FileDown size={16} className="text-blue-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Bulk Download Documents</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Select which document types to download for{' '}
            <span className="font-semibold text-gray-900 dark:text-white">{totalShipments}</span>{' '}
            shipment{totalShipments !== 1 ? 's' : ''}.
          </p>

          {/* Group by toggle */}
          <div className="flex items-center gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg w-fit">
            <button
              onClick={() => setGroupBy('shipment')}
              className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                groupBy === 'shipment'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              By Shipment
            </button>
            <button
              onClick={() => setGroupBy('doc_type')}
              className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                groupBy === 'doc_type'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              By Document Type
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Checking available documents…</span>
            </div>
          ) : availableTypes.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              No documents found for the selected shipments.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {availableTypes.length} type{availableTypes.length !== 1 ? 's' : ''} available
                </span>
                <button
                  onClick={toggleAll}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {selectedTypes.size === availableTypes.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              {DOC_GROUPS.map(group => {
                const groupTypes = group.types.filter(t => availableTypes.includes(t))
                if (groupTypes.length === 0) return null
                return (
                  <div key={group.label}>
                    <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                      {group.label}
                    </p>
                    <div className="space-y-0.5">
                      {groupTypes.map(type => {
                        const count = (byType[type] ?? []).length
                        return (
                          <label
                            key={type}
                            className="flex items-center gap-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 py-1.5 rounded-lg"
                          >
                            <input
                              type="checkbox"
                              checked={selectedTypes.has(type)}
                              onChange={() => toggleType(type)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">
                              {DOC_TYPE_LABELS[type as DocumentType] ?? type}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                              {count}/{totalShipments}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t dark:border-gray-700">
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || selectedTypes.size === 0 || loading}
            className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg font-medium"
          >
            {downloading
              ? <Loader2 size={13} className="animate-spin" />
              : <Download size={13} />
            }
            {downloading
              ? 'Downloading…'
              : `Download (${selectedTypes.size} type${selectedTypes.size !== 1 ? 's' : ''})`
            }
          </button>
        </div>
      </div>
    </div>
  )
}
