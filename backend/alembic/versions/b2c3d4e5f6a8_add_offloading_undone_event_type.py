"""add OFFLOADING_UNDONE to event_type_enum

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-06-26

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'b2c3d4e5f6a8'
down_revision: Union[str, tuple, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'OFFLOADING_UNDONE'")


def downgrade() -> None:
    pass
