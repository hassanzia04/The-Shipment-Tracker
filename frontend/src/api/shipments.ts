import { api } from '@/lib/api'
import type { Shipment, ShipmentListItem, Task, ContainerViewItem } from '@/types'

export interface PaginatedShipments {
  items: ShipmentListItem[]
  total: number
  skip: number
  limit: number
}

export interface PaginatedContainerView {
  items: ContainerViewItem[]
  total: number
  skip: number
  limit: number
}

export const shipmentsApi = {
  list: (params?: { skip?: number; limit?: number; search?: string; stage?: string; company_id?: string; company_ids?: string; my_queue?: boolean; task_type_filter?: string; missing_date?: boolean; amls_search?: string; missing_amls?: boolean; pull_out_from?: string; pull_out_to?: string; sort_by?: string; sort_dir?: string; historical?: boolean; completed_from?: string; completed_to?: string; consignee_search?: string; port_search?: string; offloading_search?: string; bayan_type_search?: string; shipping_line_search?: string; eta_from?: string; eta_to?: string; do_validity_from?: string; do_validity_to?: string; permit_search?: string; do_expired?: boolean }) =>
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
    offloading_point_id?: string
    bayan_type_id?: string
    eta_at_port?: string
    consignee_id?: string
    remark?: string
  }) => api.post<Shipment>('/shipments', data),

  update: (id: string, data: Partial<{
    bl_number: string
    invoice_number: string
    container_count: number
    pull_out_date: string
    product_type_id: string
    loading_port_id: string
    shipping_line_id: string
    rop_inspection_type_id: string
    offloading_point_id: string
    bayan_type_id: string
    eta_at_port: string
    consignee_id: string
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

  delegateCcroRop: (id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/delegate-ccro-rop`, { remark }),

  requestBayanPayment: (id: string, remark?: string) =>
    api.post<Shipment>(`/shipments/${id}/request-bayan-payment`, { remark }),

  addContainer: (id: string, container_number: string) =>
    api.post<Shipment>(`/shipments/${id}/containers`, { container_number }),

  renameContainer: (shipmentId: string, containerId: string, container_number: string) =>
    api.patch<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/number`, { container_number }),

  confirmCcro: (id: string) => api.post<Shipment>(`/shipments/${id}/confirm-ccro`),

  getBayanContainers: (id: string) =>
    api.get<{ container_numbers: string[]; bayan_document_id: string | null }>(`/shipments/${id}/bayan-containers`),

  confirmSalalahTransport: (id: string, container_numbers: string[]) =>
    api.post<Shipment>(`/shipments/${id}/confirm-salalah-transport`, { container_numbers }),

  recallFromTransport: (id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/recall-from-transport`, { remark }),

  setPermitRef: (id: string, permit_ref: string | null) =>
    api.post<Shipment>(`/shipments/${id}/permit-ref`, { permit_ref }),

  setDoValidity: (id: string, do_validity_date: string) =>
    api.post<Shipment>(`/shipments/${id}/do-validity`, { do_validity_date }),

  completeTaskByType: (shipmentId: string, taskType: string, options?: { skipPaymentEmail?: boolean }) =>
    api.post(`/shipments/${shipmentId}/complete-task-by-type`, null, { params: { task_type: taskType, skip_payment_email: options?.skipPaymentEmail ?? false } }),

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

  completeTask: (shipmentId: string, taskId: string, remark?: string, permitNotRequired?: boolean) =>
    api.post<Shipment>(`/shipments/${shipmentId}/tasks/${taskId}/complete`, { remark, permit_not_required: permitNotRequired ?? false }),

  // Transport
  assignTruck: (id: string, data: {
    container_id: string
    truck_id: string
    expected_arrival_at: string
    offloading_point_id?: string
    driver_name?: string
  }) => api.post<Shipment>(`/shipments/${id}/assign-truck`, data),

  markBreakdown: (id: string, container_id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/breakdown`, { container_id, remark }),

  sendBackToCustomer: (id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/send-back-to-customer`, { remark }),

  requestDoRevalidation: (shipmentId: string, containerId: string, remark: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/request-do-revalidation`, { remark }),

  markDoRevalidated: (shipmentId: string, containerId: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/mark-do-revalidated`),

  unassignTruck: (shipmentId: string, containerId: string, remark: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/unassign-truck`, { remark }),

  returnContainerToFfd: (shipmentId: string, containerId: string, remark: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/return-to-ffd`, { remark }),

  resetContainerToTransport: (shipmentId: string, containerId: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/reset-to-transport`),

  closeContainer: (shipmentId: string, containerId: string, remark: string) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/close-container`, { remark }),

  assignOutsourcedTruck: (shipmentId: string, containerId: string, data: { outsourced_truck_id: string; expected_arrival_at: string }) =>
    api.post<Shipment>(`/shipments/${shipmentId}/containers/${containerId}/assign-outsourced-truck`, data),

  deleteContainer: (shipmentId: string, containerId: string) =>
    api.delete<Shipment>(`/shipments/${shipmentId}/containers/${containerId}`),

  markReturned: (id: string, container_id: string) =>
    api.post<Shipment>(`/shipments/${id}/mark-returned`, { container_id }),

  // DC
  markOffloaded: (id: string, container_id: string, offloaded_at?: string) =>
    api.post<Shipment>(`/shipments/${id}/mark-offloaded`, { container_id, offloaded_at: offloaded_at ?? null }),

  undoOffloaded: (id: string, container_id: string, remark: string) =>
    api.post<Shipment>(`/shipments/${id}/undo-offloaded`, { container_id, remark }),

  containerView: (params?: { historical?: boolean; skip?: number; limit?: number; search?: string; status?: string; from_date?: string; to_date?: string; amls_only?: boolean; sort_by?: string; sort_dir?: string; company_id?: string; company_ids?: string }) =>
    api.get<PaginatedContainerView>('/shipments/container-view', { params }),

  bulkCcroUpload: (shipmentId: string, files: File[], containerNumbers?: (string | null)[]) => {
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    if (containerNumbers) containerNumbers.forEach(cn => form.append('container_numbers', cn ?? ''))
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

  exportContainerBilling: (id: string, params?: { search?: string; from_date?: string; to_date?: string }) =>
    api.get(`/shipments/${id}/container-billing-export`, { params, responseType: 'blob' }),

  containerViewExport: (params?: { search?: string; from_date?: string; to_date?: string; status?: string; historical?: boolean; amls_only?: boolean; do_expired?: boolean; do_validity_from?: string; do_validity_to?: string; company_id?: string; company_ids?: string }) =>
    api.get('/shipments/container-view-export', { params, responseType: 'blob' }),

  blExport: (params?: { search?: string; stage?: string; my_queue?: boolean; missing_date?: boolean; amls_search?: string; missing_amls?: boolean; pull_out_from?: string; pull_out_to?: string; historical?: boolean; completed_from?: string; completed_to?: string; do_expired?: boolean; do_validity_from?: string; do_validity_to?: string; company_id?: string; company_ids?: string }) =>
    api.get('/shipments/bl-export', { params, responseType: 'blob' }),

  bulkUpdatePullOutDate: (shipment_ids: string[], pull_out_date: string) =>
    api.post('/shipments/bulk-pull-out-date', { shipment_ids, pull_out_date }),

  bulkRequestBayanPayment: (shipment_ids: string[], remark?: string) =>
    api.post('/shipments/bulk-bayan-payment-request', { shipment_ids, remark }),

  bulkConfirmCcro: (shipment_ids: string[]) =>
    api.post<{ confirmed: number; skipped: string[] }>('/shipments/bulk-confirm-ccro', { shipment_ids }),

  getSalalahReady: () =>
    api.get<{ items: Array<{ shipment_id: string; bl_number: string; existing_containers: string[]; bayan_suggestions: string[] }> }>('/shipments/salalah-ready'),

  bulkConfirmSalalah: (items: Array<{ shipment_id: string; container_numbers: string[] }>) =>
    api.post<{ confirmed: number }>('/shipments/bulk-confirm-salalah', { items }),

  bulkOpenBayan: (shipment_ids: string[]) =>
    api.post('/shipments/bulk-open-bayan', { shipment_ids }),

  bulkAssignTask: (shipment_ids: string[], task_type: string, assignee_id: string) =>
    api.post('/shipments/bulk-assign-task', { shipment_ids, task_type, assignee_id }),

  bulkAssignHold: (shipment_ids: string[], hold_entity: string, hold_reason: string, hold_remark: string | null, task_types: string[]) =>
    api.post('/shipments/bulk-assign-hold', { shipment_ids, hold_entity, hold_reason, hold_remark, task_types }),

  bulkReleaseHold: (shipment_ids: string[], release_remark: string | null, task_types: string[]) =>
    api.post('/shipments/bulk-release-hold', { shipment_ids, release_remark, task_types }),

  bulkDelete: (shipment_ids: string[]) =>
    api.post('/shipments/bulk-delete', { shipment_ids }),

  setAmlsJob: (id: string, amls_job_number: string | null) =>
    api.patch(`/shipments/${id}/amls-job`, { amls_job_number }),

  importTemplate: () =>
    api.get('/shipments/import-template', { responseType: 'blob' }),

  importExcel: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ inserted: number; inserted_bls: string[]; skipped: number; errors: string[] }>(
      '/shipments/import',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
  },
}
