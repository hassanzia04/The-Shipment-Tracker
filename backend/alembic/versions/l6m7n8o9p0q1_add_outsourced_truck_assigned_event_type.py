"""add OUTSOURCED_TRUCK_ASSIGNED to event_type_enum

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
Create Date: 2026-06-09
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'l6m7n8o9p0q1'
down_revision: Union[str, tuple, None] = 'k5l6m7n8o9p0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'OUTSOURCED_TRUCK_ASSIGNED'")


def downgrade() -> None:
    pass
