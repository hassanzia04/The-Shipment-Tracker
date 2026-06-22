"""add permit_not_required to shipments

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-06-18
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 't4u5v6w7x8y9'
down_revision: Union[str, tuple, None] = 's3t4u5v6w7x8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shipments', sa.Column('permit_not_required', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('shipments', 'permit_not_required')
