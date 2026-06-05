from enum import Enum


class Team(str, Enum):
    CUSTOMER = "CUSTOMER"
    FFD = "FFD"
    PRO = "PRO"
    TRANSPORT = "TRANSPORT"
    DC = "DC"
    MANAGEMENT = "MANAGEMENT"


class ShipmentStage(str, Enum):
    CUSTOMER = "CUSTOMER"
    FFD_REVIEW = "FFD_REVIEW"
    IN_PROGRESS = "IN_PROGRESS"   # parallel PRO + FFD work (Permit/Bayan/DO/CCRO)
    TRANSPORT = "TRANSPORT"
    DC_TRANSPORT = "DC_TRANSPORT"  # DC offloading, Transport standing by
    COMPLETED = "COMPLETED"


class TaskType(str, Enum):
    PERMIT = "PERMIT"
    BAYAN = "BAYAN"
    DO = "DO"
    CCRO = "CCRO"
    CCRO_ROP = "CCRO_ROP"         # CCRO ROP issue delegated to PRO
    BAYAN_PAYMENT = "BAYAN_PAYMENT"  # Bayan payment request delegated to Customer


class TaskStatus(str, Enum):
    IN_PROGRESS = "IN_PROGRESS"
    ON_HOLD = "ON_HOLD"
    COMPLETED = "COMPLETED"


class ExternalEntity(str, Enum):
    SHIPPING_LINE = "SHIPPING_LINE"
    ROP = "ROP"
    MOAF = "MOAF"
    PORT = "PORT"
    OTHER = "OTHER"


class HoldReason(str, Enum):
    # Shipping Line
    SL_DO_NOT_SENT = "SL_DO_NOT_SENT"
    SL_DO_EXPIRED_REVALIDATING = "SL_DO_EXPIRED_REVALIDATING"
    SL_MANIFEST_NOT_UPLOADED = "SL_MANIFEST_NOT_UPLOADED"
    SL_DOCUMENTATION_ISSUE = "SL_DOCUMENTATION_ISSUE"
    # ROP
    ROP_APPROVAL_PENDING = "ROP_APPROVAL_PENDING"
    ROP_CCRO_ISSUE = "ROP_CCRO_ISSUE"
    # MOAF
    MOAF_APPROVAL_PENDING = "MOAF_APPROVAL_PENDING"
    # PORT
    PORT_AWAITING_CCRO = "PORT_AWAITING_CCRO"
    PORT_REJECTED_ROP_ISSUE = "PORT_REJECTED_ROP_ISSUE"
    PORT_REJECTED_SL_ISSUE = "PORT_REJECTED_SL_ISSUE"
    # Generic
    OTHER = "OTHER"


# Maps which hold reasons are valid for each external entity
HOLD_REASON_MAP: dict[ExternalEntity, list[HoldReason]] = {
    ExternalEntity.SHIPPING_LINE: [
        HoldReason.SL_DO_NOT_SENT,
        HoldReason.SL_DO_EXPIRED_REVALIDATING,
        HoldReason.SL_MANIFEST_NOT_UPLOADED,
        HoldReason.SL_DOCUMENTATION_ISSUE,
        HoldReason.OTHER,
    ],
    ExternalEntity.ROP: [
        HoldReason.ROP_APPROVAL_PENDING,
        HoldReason.ROP_CCRO_ISSUE,
        HoldReason.OTHER,
    ],
    ExternalEntity.MOAF: [
        HoldReason.MOAF_APPROVAL_PENDING,
        HoldReason.OTHER,
    ],
    ExternalEntity.PORT: [
        HoldReason.PORT_AWAITING_CCRO,
        HoldReason.PORT_REJECTED_ROP_ISSUE,
        HoldReason.PORT_REJECTED_SL_ISSUE,
        HoldReason.OTHER,
    ],
    ExternalEntity.OTHER: [
        HoldReason.OTHER,
    ],
}

# Maps which external entities each team can assign holds to
TEAM_HOLD_PERMISSIONS: dict[Team, list[ExternalEntity]] = {
    Team.FFD: [ExternalEntity.SHIPPING_LINE, ExternalEntity.PORT, ExternalEntity.OTHER],
    Team.PRO: [ExternalEntity.SHIPPING_LINE, ExternalEntity.ROP, ExternalEntity.MOAF, ExternalEntity.OTHER],
}


class DocumentType(str, Enum):
    # Customer mandatory documents (all 6 required before job proceeds)
    COMMERCIAL_INVOICE = "COMMERCIAL_INVOICE"
    PACKING_LIST = "PACKING_LIST"
    CERT_OF_ORIGIN = "CERT_OF_ORIGIN"
    HALAL_CERT = "HALAL_CERT"
    BL = "BL"
    HEALTH_CERT = "HEALTH_CERT"
    # Process documents (uploaded during workflow)
    PERMIT = "PERMIT"
    BAYAN = "BAYAN"
    DO = "DO"
    CCRO = "CCRO"
    # DC documents
    DN = "DN"                          # Delivery Note — per container, mandatory before offloading
    DC_HEALTH_CERT = "DC_HEALTH_CERT"  # Health certificate — per BL, DC internal requirement


CUSTOMER_REQUIRED_DOCS = [
    DocumentType.COMMERCIAL_INVOICE,
    DocumentType.PACKING_LIST,
    DocumentType.CERT_OF_ORIGIN,
    DocumentType.HALAL_CERT,
    DocumentType.BL,
    DocumentType.HEALTH_CERT,
]


class ContainerStatus(str, Enum):
    PENDING = "PENDING"
    ASSIGNED = "ASSIGNED"
    IN_TRANSIT = "IN_TRANSIT"
    BREAKDOWN = "BREAKDOWN"
    AT_DC = "AT_DC"
    OFFLOADED = "OFFLOADED"
    RETURNED = "RETURNED"
    CCRO_RETURNED = "CCRO_RETURNED"    # Transport sent container back — awaiting FFD action
    CLOSED = "CLOSED"                  # FFD permanently closed this container
    DO_REVALIDATION = "DO_REVALIDATION"  # Transport sent offloaded container to FFD for DO revalidation


class EventType(str, Enum):
    SHIPMENT_CREATED = "SHIPMENT_CREATED"
    DOCUMENTS_SUBMITTED = "DOCUMENTS_SUBMITTED"
    DOCUMENTS_REJECTED = "DOCUMENTS_REJECTED"
    DOCUMENTS_APPROVED = "DOCUMENTS_APPROVED"
    TASK_CREATED = "TASK_CREATED"
    TASK_HOLD_ASSIGNED = "TASK_HOLD_ASSIGNED"
    TASK_HOLD_RELEASED = "TASK_HOLD_RELEASED"
    TASK_COMPLETED = "TASK_COMPLETED"
    STAGE_CHANGED = "STAGE_CHANGED"
    CONTAINER_ADDED = "CONTAINER_ADDED"
    TRUCK_ASSIGNED = "TRUCK_ASSIGNED"
    BREAKDOWN_REPORTED = "BREAKDOWN_REPORTED"
    CONTAINER_OFFLOADED = "CONTAINER_OFFLOADED"
    CONTAINER_RETURNED = "CONTAINER_RETURNED"
    SENT_BACK_TO_FFD = "SENT_BACK_TO_FFD"
    PULL_OUT_DATE_CHANGED = "PULL_OUT_DATE_CHANGED"
    TASK_ASSIGNED = "TASK_ASSIGNED"
    DO_VALIDITY_UPDATED = "DO_VALIDITY_UPDATED"
    CONTAINER_ARRIVED = "CONTAINER_ARRIVED"
    CONTAINER_RETURNED_TO_FFD = "CONTAINER_RETURNED_TO_FFD"
    CONTAINER_RESET_TO_TRANSPORT = "CONTAINER_RESET_TO_TRANSPORT"
    CONTAINER_CLOSED = "CONTAINER_CLOSED"
    SENT_BACK_TO_CUSTOMER = "SENT_BACK_TO_CUSTOMER"
    DO_REVALIDATION_REQUESTED = "DO_REVALIDATION_REQUESTED"
    DO_REVALIDATED = "DO_REVALIDATED"
