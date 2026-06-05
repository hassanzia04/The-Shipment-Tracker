"""add CCRO_RETURNED and CLOSED container statuses

Revision ID: f3a8b2e1d0c5
Revises: e8b2c5d1f9a4
Create Date: 2026-06-04 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'f3a8b2e1d0c5'
down_revision: Union[str, None] = 'e8b2c5d1f9a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE container_status_enum ADD VALUE IF NOT EXISTS 'CCRO_RETURNED'")
    op.execute("ALTER TYPE container_status_enum ADD VALUE IF NOT EXISTS 'CLOSED'")
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'CONTAINER_RETURNED_TO_FFD'")
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'CONTAINER_RESET_TO_TRANSPORT'")
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'CONTAINER_CLOSED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
