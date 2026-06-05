import { api } from '@/lib/api'
import type { Shipment, ShipmentListItem, Task, ContainerViewItem } from '@/types'

export interface PaginatedShipments {
  items: ShipmentListItem[]
  total: number
  skip: number
  limit: number
}

export const shipmentsApi = {
  list: (params?: { skip?: number; limit?: number; search?: string; stage?: string; my_queue?: boolean; missing_date?: boolean }) =>
    api.get<PaginatedShipments>('/shipments', { params }),

  get: (id: string) => api.get<Shipment>(`/shipments/${id}`),

  create: (data: {
    bl_number: string
    invoice_number: string
    container_count: number
    pull_out_date?: string
    product_type_id?: string
    loading_port_id?: string
    shipping_line_id?: string
    remark?: string
  }) => api.post<Shipment>('/shipments', data),

  update: (id: string, data: Partial<{
    pull_out_date: string
    product_type_id: string
    loading_port_id: string
    rop_inspection_type_id: string
    offloading_point_id: string
  }>) => api.patch<Shipment>(`/shipments/${id}`, data),

  // Customer
  submit: (id: string, remark?: string) => api.post<Shipment>(`/shipments/${id}/submit`, remark ? { remark } : undefined),

  // FFD
  rejectDocs: (id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/reject-docs`, { remark }),

  approveDocs: (id: string, rop_inspection_type_id?: string) =>
    api.post<Shipment>(`/shipments/${id}/approve-docs`, { rop_inspection_type_id }),

  openBayan: (id: string) => api.post<Shipment>(`/shipments/${id}/open-bayan`),

  openCcro: (id: string) => api.post<Shipment>(`/shipments/${id}/open-ccro`),

  delegateCcroRop: (id: string, remark?: string) =>
    api.post<Shipment>(`/shipments/${id}/delegate-ccro-rop`, { remark }),

  requestBayanPayment: (id: string, remark?: string) =>
    api.post<Shipment>(`/shipments/${id}/request-bayan-payment`, { remark }),

  addContainer: (id: string, container_number: string) =>
    api.post<Shipment>(`/shipments/${id}/containers`, { container_number }),

  renameContainer: (shipmentId: string, containerId: string, container_number: string) =>
    api.patch<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/number`, { container_number }),

  confirmCcro: (id: string) => api.post<Shipment>(`/shipments/${id}/confirm-ccro`),

  setDoValidity: (id: string, do_validity_date: string) =>
    api.post<Shipment>(`/shipments/${id}/do-validity`, { do_validity_date }),

  // Task assignment (FFD → PRO)
  assignTask: (shipmentId: string, taskId: string, assigneeId: string, remark?: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/tasks/${taskId}/assign`, { assignee_id: assigneeId, remark }),

  // Tasks
  assignHold: (shipmentId: string, taskId: string, data: {
    hold_entity: string
    hold_reason: string
    hold_remark: string
  }) => api.post<Task>(`/shipments/${shipmentId}/tasks/${taskId}/hold`, data),

  releaseHold: (shipmentId: string, taskId: string, release_remark: string) =>
    api.post<Task>(`/shipments/${shipmentId}/tasks/${taskId}/release-hold`, { release_remark }),

  completeTask: (shipmentId: string, taskId: string, remark?: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/tasks/${taskId}/complete`, { remark }),

  // Transport
  assignTruck: (id: string, data: {
    container_id: string
    truck_id: string
    expected_arrival_at: string
    offloading_point_id?: string
  }) => api.post<Shipment>(`/shipments/${id}/assign-truck`, data),

  markBreakdown: (id: string, container_id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/breakdown`, { container_id, remark }),

  sendBackToCustomer: (id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/send-back-to-customer`, { remark }),

  requestDoRevalidation: (shipmentId: string, containerId: string, remark: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/request-do-revalidation`, { remark }),

  markDoRevalidated: (shipmentId: string, containerId: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/mark-do-revalidated`),

  returnContainerToFfd: (shipmentId: string, containerId: string, remark: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/return-to-ffd`, { remark }),

  resetContainerToTransport: (shipmentId: string, containerId: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/reset-to-transport`),

  closeContainer: (shipmentId: string, containerId: string, remark: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/close-container`, { remark }),

  markReturned: (id: string, container_id: string) =>
    api.post<Shipment>(`/shipments/${id}/mark-returned`, { container_id }),

  // DC
  markOffloaded: (id: string, container_id: string) =>
    api.post<Shipment>(`/shipments/${id}/mark-offloaded`, { container_id }),

  containerView: (historical = false) =>
    api.get<ContainerViewItem[]>('/shipments/container-view', { params: { historical } }),

  bulkCcroUpload: (shipmentId: string, files: File[]) => {
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    return api.post<{
      results: { filename: string; container_number: string | null; status: 'created' | 'matched' | 'not_detected' | 'duplicate'; container_id: string | null; conflict_bl?: string }[]
      matched: number
      created: number
      failed: number
      duplicates: number
    }>(`/shipments/${shipmentId}/bulk-ccro`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  markArrived: (shipmentId: string, containerId: string, arrivedAt?: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/mark-arrived`, { arrived_at: arrivedAt ?? null }),

  delete: (id: string) => api.delete(`/shipments/${id}`),

  importTemplate: () =>
    api.get('/shipments/import-template', { responseType: 'blob' }),

  importExcel: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ inserted: number; skipped: number; errors: string[] }>(
      '/shipments/import',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
  },
}
