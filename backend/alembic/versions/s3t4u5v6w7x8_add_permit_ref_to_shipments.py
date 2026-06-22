"""add permit_ref to shipments

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-06-16
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 's3t4u5v6w7x8'
down_revision: Union[str, tuple, None] = 'r2s3t4u5v6w7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shipments', sa.Column('permit_ref', sa.String(200), nullable=True))
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'PERMIT_REF_UPDATED'")


def downgrade() -> None:
    op.drop_column('shipments', 'permit_ref')
