export type Team = 'CUSTOMER' | 'FFD' | 'PRO' | 'TRANSPORT' | 'DC' | 'MANAGEMENT' | 'CUSTOMER_MANAGEMENT'

export type ShipmentStage =
  | 'CUSTOMER'
  | 'FFD_REVIEW'
  | 'IN_PROGRESS'
  | 'TRANSPORT'
  | 'DC_TRANSPORT'
  | 'COMPLETED'

export type TaskType = 'PERMIT' | 'BAYAN' | 'DO' | 'CCRO' | 'CCRO_ROP' | 'BAYAN_PAYMENT'
export type TaskStatus = 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED'

export type ExternalEntity = 'SHIPPING_LINE' | 'ROP' | 'MOAF' | 'PORT' | 'OTHER'

export type HoldReason =
  | 'SL_DO_NOT_SENT'
  | 'SL_DO_EXPIRED_REVALIDATING'
  | 'SL_MANIFEST_NOT_UPLOADED'
  | 'SL_DOCUMENTATION_ISSUE'
  | 'ROP_APPROVAL_PENDING'
  | 'ROP_CCRO_ISSUE'
  | 'MOAF_APPROVAL_PENDING'
  | 'PORT_AWAITING_CCRO'
  | 'PORT_REJECTED_ROP_ISSUE'
  | 'PORT_REJECTED_SL_ISSUE'
  | 'OTHER'

export type DocumentType =
  | 'COMBINED_DOCS'
  | 'COMMERCIAL_INVOICE'
  | 'PACKING_LIST'
  | 'CERT_OF_ORIGIN'
  | 'HALAL_CERT'
  | 'BL'
  | 'HEALTH_CERT'
  | 'MISCELLANEOUS'
  | 'PERMIT'
  | 'BAYAN'
  | 'DO'
  | 'CCRO'
  | 'DN'
  | 'DC_HEALTH_CERT'

export type ContainerStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_TRANSIT'
  | 'BREAKDOWN'
  | 'AT_DC'
  | 'OFFLOADED'
  | 'RETURNED'
  | 'CCRO_RETURNED'
  | 'CLOSED'
  | 'DO_REVALIDATION'
  | 'OUTSOURCED_TRANSPORT'

export interface User {
  id: string
  email: string
  full_name: string
  team: Team
  is_active: boolean
  is_admin: boolean
  company_id: string | null
  company_name: string | null
  focus_company_ids: string[] | null
  created_at: string
}

export interface Company {
  id: string
  name: string
  is_active: boolean
  daily_report_enabled: boolean
  daily_report_send_time: string | null
  created_at: string
  user_count: number
  shipment_count: number
}

/** Customer-side teams (tenant-scoped users). Covers CUSTOMER_MANAGEMENT too —
 * use this instead of ad-hoc `team === 'CUSTOMER'` checks for tenancy gating. */
export const isCustomerTeam = (user: { team: Team } | null | undefined): boolean =>
  user?.team === 'CUSTOMER' || user?.team === 'CUSTOMER_MANAGEMENT'

export interface Task {
  id: string
  task_type: TaskType
  assigned_team: string
  status: TaskStatus
  hold_entity: ExternalEntity | null
  hold_reason: HoldReason | null
  hold_remark: string | null
  release_remark: string | null
  created_at: string
  completed_at: string | null
  assigned_to_id: string | null
  assigned_to_name: string | null
}

export interface ShipmentEvent {
  id: string
  task_id: string | null
  event_type: string
  stage_from: ShipmentStage | null
  stage_to: ShipmentStage | null
  actor_id: string
  actor_name: string | null
  actor_team: string | null
  remark: string | null
  duration_seconds: number | null
  created_at: string
}

export interface Container {
  id: string
  container_number: string
  truck_id: string | null
  expected_arrival_at: string | null
  offloading_point_id: string | null
  status: ContainerStatus
  revalidation_remark: string | null
  actual_pull_out_date: string | null
  offloaded_at: string | null
  outsourced_truck_id: string | null
  outsourced_expected_arrival_at: string | null
  created_at: string
  updated_at: string
}

export interface Shipment {
  id: string
  bl_number: string
  invoice_number: string
  customer_id: string
  company_id: string
  company_name: string | null
  current_stage: ShipmentStage
  pull_out_date: string | null
  product_type_id: string | null
  loading_port_id: string | null
  shipping_line_id: string | null
  rop_inspection_type_id: string | null
  offloading_point_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  do_validity_date: string | null
  permit_ref: string | null
  permit_not_required: boolean
  container_count: number | null
  amls_job_number: string | null
  offloading_point_name: string | null
  offloading_is_amls: boolean
  product_type_name: string | null
  loading_port_name: string | null
  shipping_line_name: string | null
  bayan_type_id: string | null
  bayan_type_name: string | null
  eta_at_port: string | null
  consignee_id: string | null
  consignee_name: string | null
  tasks: Task[]
  containers: Container[]
  events: ShipmentEvent[]
}

export interface ShipmentListItem {
  id: string
  bl_number: string
  invoice_number: string
  current_stage: ShipmentStage
  pull_out_date: string | null
  offloading_point_name: string | null
  created_at: string
  updated_at: string
  // Progress status
  docs_approved: boolean
  permit_status: TaskStatus | null
  permit_user: string | null
  permit_assigned_to_id: string | null
  permit_task_id: string | null
  permit_not_required: boolean
  do_status: TaskStatus | null
  do_user: string | null
  do_assigned_to_id: string | null
  bayan_status: TaskStatus | null
  bayan_user: string | null
  bayan_assigned_to_id: string | null
  ccro_status: TaskStatus | null
  bayan_payment_pending: boolean
  bayan_payment_task_id: string | null
  do_revalidation_count: number
  ccro_returned_count: number
  dc_health_cert_missing: boolean
  dn_missing: boolean
  amls_job_number: string | null
  permit_ref: string | null
  do_validity_date: string | null
  eta_at_port: string | null
  consignee_name: string | null
  loading_port_name: string | null
  bayan_type_name: string | null
  shipping_line_name: string | null
  offloading_date: string | null
  company_name: string | null
  stage_since: string | null
}

export interface ContainerViewItem {
  container_id: string
  container_number: string
  shipment_id: string
  bl_number: string
  container_count: number | null
  status: ContainerStatus
  arrived_at: string | null
  do_validity_date: string | null
  truck_id: string | null
  plate_number: string | null
  driver_name: string | null
  contractor: string | null
  offloading_point_id: string | null
  offloading_point_name: string | null
  expected_arrival_at: string | null
  ccro_document_id: string | null
  was_requeued: boolean
  shipment_stage: string | null
  revalidation_remark: string | null
  dn_document_id: string | null
  dc_health_cert_uploaded: boolean
  actual_pull_out_date: string | null
  offloaded_at: string | null
  pull_out_date: string | null
  offloading_is_amls: boolean
  outsourced_truck_id: string | null
  outsourced_expected_arrival_at: string | null
  outsourced_plate_number: string | null
  outsourced_driver_name: string | null
  loading_port_name: string | null
  bayan_type_name: string | null
  company_name: string | null
}

export interface OutsourcedTruck {
  id: string
  plate_number: string
  driver_name: string
  contractor: string
  nationality: string
  is_active: boolean
  created_at: string
}

export interface Document {
  id: string
  shipment_id: string
  task_id: string | null
  container_id: string | null
  doc_type: DocumentType
  original_filename: string
  original_size_bytes: number
  compressed_size_bytes: number
  uploaded_by_id: string
  uploaded_at: string
}

export interface MasterItem {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

export interface Truck {
  id: string
  plate_number: string
  driver_name: string
  contractor: string
  nationality: string
  is_active: boolean
  created_at: string
}

export const TEAM_LABELS: Record<Team, string> = {
  CUSTOMER:            'Customer',
  FFD:                 'FFD',
  PRO:                 'PRO',
  TRANSPORT:           'Transport',
  DC:                  'DC',
  MANAGEMENT:          'Management',
  CUSTOMER_MANAGEMENT: 'Customer Management',
}

// Label maps for display
export const STAGE_LABELS: Record<ShipmentStage, string> = {
  CUSTOMER: 'Customer',
  FFD_REVIEW: 'FFD Review',
  IN_PROGRESS: 'In Progress',
  TRANSPORT: 'Transport',
  DC_TRANSPORT: 'DC / Transport',
  COMPLETED: 'Completed',
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  PERMIT: 'Permit',
  BAYAN: 'Bayan',
  DO: 'Delivery Order',
  CCRO: 'CCRO',
  CCRO_ROP: 'CCRO — ROP Issue',
  BAYAN_PAYMENT: 'Bayan Payment',
}

export const ENTITY_LABELS: Record<ExternalEntity, string> = {
  SHIPPING_LINE: 'Shipping Line',
  ROP: 'ROP',
  MOAF: 'MOAF',
  PORT: 'Port',
  OTHER: 'Other',
}

export const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  SL_DO_NOT_SENT: 'DO not yet sent',
  SL_DO_EXPIRED_REVALIDATING: 'DO expired — revalidating',
  SL_MANIFEST_NOT_UPLOADED: 'Manifest not uploaded',
  SL_DOCUMENTATION_ISSUE: 'Documentation issue',
  ROP_APPROVAL_PENDING: 'Approval pending',
  ROP_CCRO_ISSUE: 'CCRO issue',
  MOAF_APPROVAL_PENDING: 'Approval pending',
  PORT_AWAITING_CCRO: 'Awaiting CCRO issuance',
  PORT_REJECTED_ROP_ISSUE: 'Rejected — ROP approval issue',
  PORT_REJECTED_SL_ISSUE: 'Rejected — Shipping Line documentation issue',
  OTHER: 'Other (see remarks)',
}

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  COMBINED_DOCS: 'Required Documents',
  COMMERCIAL_INVOICE: 'Commercial Invoice',
  PACKING_LIST: 'Packing List',
  CERT_OF_ORIGIN: 'Certificate of Origin',
  HALAL_CERT: 'Halal Certificate',
  BL: 'Bill of Lading',
  HEALTH_CERT: 'Health Certificate',
  MISCELLANEOUS: 'Miscellaneous',
  PERMIT: 'Permit',
  BAYAN: 'Bayan',
  DO: 'Delivery Order',
  CCRO: 'CCRO',
  DN: 'Delivery Note',
  DC_HEALTH_CERT: 'Health Certificate (DC)',
}

export const CUSTOMER_REQUIRED_DOCS: DocumentType[] = [
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'CERT_OF_ORIGIN',
  'HALAL_CERT',
  'BL',
  'HEALTH_CERT',
]

export const DOC_TYPE_OPTIONAL_DOCS: DocumentType[] = [
  'MISCELLANEOUS',
]

export const TEAM_HOLD_PERMISSIONS: Partial<Record<Team, ExternalEntity[]>> = {
  FFD: ['SHIPPING_LINE', 'ROP', 'MOAF', 'PORT', 'OTHER'],
  PRO: ['SHIPPING_LINE', 'ROP', 'MOAF', 'OTHER'],
}

export const HOLD_REASON_MAP: Record<ExternalEntity, HoldReason[]> = {
  SHIPPING_LINE: ['SL_DO_NOT_SENT', 'SL_DO_EXPIRED_REVALIDATING', 'SL_MANIFEST_NOT_UPLOADED', 'SL_DOCUMENTATION_ISSUE', 'OTHER'],
  ROP: ['ROP_APPROVAL_PENDING', 'ROP_CCRO_ISSUE', 'OTHER'],
  MOAF: ['MOAF_APPROVAL_PENDING', 'OTHER'],
  PORT: ['PORT_AWAITING_CCRO', 'PORT_REJECTED_ROP_ISSUE', 'PORT_REJECTED_SL_ISSUE', 'OTHER'],
  OTHER: ['OTHER'],
}
