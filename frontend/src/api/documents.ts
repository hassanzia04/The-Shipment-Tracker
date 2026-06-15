import { api } from '@/lib/api'
import type { Document, DocumentType } from '@/types'
import toast from 'react-hot-toast'

export const documentsApi = {
  list: (shipmentId: string) => api.get<Document[]>(`/documents/shipment/${shipmentId}`),

  upload: (data: {
    shipment_id: string
    doc_type: DocumentType
    file: File
    task_id?: string
    container_id?: string
  }) => {
    const form = new FormData()
    form.append('shipment_id', data.shipment_id)
    form.append('doc_type', data.doc_type)
    form.append('file', data.file)
    if (data.task_id) form.append('task_id', data.task_id)
    if (data.container_id) form.append('container_id', data.container_id)
    return api.post<Document>('/documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  detectType: (file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ doc_type: string | null }>('/documents/detect-type', form, { signal })
  },

  getUrl: (documentId: string) => api.get<{ url: string }>(`/documents/${documentId}/url`),

  getContent: (documentId: string) =>
    api.get(`/documents/${documentId}/content`, {
      responseType: 'blob',
    }),
  getDownloadUrl: (documentId: string) =>
    api.get<{ url: string }>(`/documents/${documentId}/url?download=true`),

  downloadAll: (shipmentId: string) =>
    api.get(`/documents/shipment/${shipmentId}/zip`, { responseType: 'blob' }),

  downloadPendingCcrosZip: () =>
    api.get('/documents/ccros/pending-zip', { responseType: 'blob' }),

  splitUpload: (data: {
    shipment_id: string
    file: File
    segments: Array<{ doc_type: DocumentType; pages: number[] }>
  }) => {
    const form = new FormData()
    form.append('shipment_id', data.shipment_id)
    form.append('file', data.file)
    form.append('segments', JSON.stringify(data.segments))
    return api.post<Document[]>('/documents/split-upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  splitByDocument: (data: {
    source_document_id: string
    shipment_id: string
    segments: Array<{ doc_type: DocumentType; pages: number[] }>
  }) => {
    const form = new FormData()
    form.append('source_document_id', data.source_document_id)
    form.append('shipment_id', data.shipment_id)
    form.append('segments', JSON.stringify(data.segments))
    return api.post<Document[]>('/documents/split-by-document', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  aiDetectSplits: (data: { file?: File; sourceDocumentId?: string }) => {
    const form = new FormData()
    if (data.file) form.append('file', data.file)
    if (data.sourceDocumentId) form.append('source_document_id', data.sourceDocumentId)
    return api.post<Array<{ doc_type: DocumentType; pages: string }>>(
      '/documents/ai-detect-splits',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000 },
    )
  },

  delete: (documentId: string) => api.delete(`/documents/${documentId}`),
}

export const openDocument = async (documentOrId: string | { id: string }) => {
  const documentId = typeof documentOrId === 'string' ? documentOrId : documentOrId.id
  try {
    const { data } = await documentsApi.getUrl(documentId)
    const a = document.createElement('a')
    a.href = data.url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 100)
  } catch {
    toast.error('Could not open document')
  }
}
