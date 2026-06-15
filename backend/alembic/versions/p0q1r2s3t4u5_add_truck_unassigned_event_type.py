"""add TRUCK_UNASSIGNED to event_type_enum

Revision ID: p0q1r2s3t4u5
Revises: o9p0q1r2s3t4
Create Date: 2026-06-11
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'p0q1r2s3t4u5'
down_revision: Union[str, tuple, None] = 'o9p0q1r2s3t4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'TRUCK_UNASSIGNED'")


def downgrade() -> None:
    pass
