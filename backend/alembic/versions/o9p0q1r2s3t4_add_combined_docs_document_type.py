"""Add COMBINED_DOCS to doc_type_enum

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
Create Date: 2026-06-11

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'o9p0q1r2s3t4'
down_revision: Union[str, None] = 'n8o9p0q1r2s3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE doc_type_enum ADD VALUE IF NOT EXISTS 'COMBINED_DOCS'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
