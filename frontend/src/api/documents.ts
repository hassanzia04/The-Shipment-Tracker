import { api } from '@/lib/api'
import type { Document, DocumentType } from '@/types'

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

  delete: (documentId: string) => api.delete(`/documents/${documentId}`),
}

export const openDocument = async (documentOrId: string | { id: string }) => {
  const documentId = typeof documentOrId === 'string' ? documentOrId : documentOrId.id
  const { data } = await documentsApi.getUrl(documentId)
  window.open(data.url, '_blank', 'noopener,noreferrer')
}
