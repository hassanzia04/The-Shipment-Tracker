"""add BAYAN_PAYMENT task type

Revision ID: e8c2a7f1d930
Revises: d7f1a3c9e042
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'e8c2a7f1d930'
down_revision: Union[str, None] = 'd7f1a3c9e042'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE task_type_enum ADD VALUE IF NOT EXISTS 'BAYAN_PAYMENT'")


def downgrade() -> None:
    pass  # PostgreSQL does not support removing enum values
