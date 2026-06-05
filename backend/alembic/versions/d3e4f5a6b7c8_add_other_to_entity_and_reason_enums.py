"""add OTHER to external_entity_enum and hold_reason_enum

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-06-05 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE external_entity_enum ADD VALUE IF NOT EXISTS 'OTHER'")
    op.execute("ALTER TYPE hold_reason_enum ADD VALUE IF NOT EXISTS 'OTHER'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; downgrade is a no-op
    pass
