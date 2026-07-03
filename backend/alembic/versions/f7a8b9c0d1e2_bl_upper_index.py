"""functional index on UPPER(bl_number)

The bulk-upload analyzers (bayan, DO, CCRO, misc) match filename tokens with
UPPER(bl_number) = :token, which the plain unique index on bl_number cannot
serve. This keeps those lookups indexed as shipment volume grows.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, tuple, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_shipments_bl_upper', 'shipments', [sa.text('upper(bl_number)')])


def downgrade() -> None:
    op.drop_index('ix_shipments_bl_upper', table_name='shipments')
