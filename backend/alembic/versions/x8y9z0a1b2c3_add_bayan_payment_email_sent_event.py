"""add BAYAN_PAYMENT_EMAIL_SENT to event_type_enum

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-06-22

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'x8y9z0a1b2c3'
down_revision: Union[str, tuple, None] = 'w7x8y9z0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'BAYAN_PAYMENT_EMAIL_SENT'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; would require recreating the type
    pass
