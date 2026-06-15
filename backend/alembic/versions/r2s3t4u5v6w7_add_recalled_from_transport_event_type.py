"""add RECALLED_FROM_TRANSPORT to event_type_enum

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-06-13
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'r2s3t4u5v6w7'
down_revision: Union[str, tuple, None] = 'q1r2s3t4u5v6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'RECALLED_FROM_TRANSPORT'")


def downgrade() -> None:
    pass
