"""add SHIPMENT_DETAILS_CHANGED to event_type_enum

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-06-20

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'w7x8y9z0a1b2'
down_revision: Union[str, tuple, None] = 'v6w7x8y9z0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE 'SHIPMENT_DETAILS_CHANGED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; would require recreating the type
    pass
