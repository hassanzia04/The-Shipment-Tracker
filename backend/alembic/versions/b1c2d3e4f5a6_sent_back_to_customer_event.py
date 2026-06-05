"""add SENT_BACK_TO_CUSTOMER event type

Revision ID: b1c2d3e4f5a6
Revises: a9c1d2e3f4b5
Create Date: 2026-06-04 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a9c1d2e3f4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'SENT_BACK_TO_CUSTOMER'")


def downgrade() -> None:
    pass
