"""add pull_out_date_changed event type

Revision ID: a3f92c1d0e47
Revises: 14ab10250349
Create Date: 2026-06-03 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'a3f92c1d0e47'
down_revision: Union[str, None] = '14ab10250349'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'PULL_OUT_DATE_CHANGED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; downgrade is a no-op
    pass
