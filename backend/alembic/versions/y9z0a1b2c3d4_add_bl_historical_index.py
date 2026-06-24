"""add composite index on shipments for historical BL view

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-06-24

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'y9z0a1b2c3d4'
down_revision: Union[str, tuple, None] = 'x8y9z0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Composite index for the historical BL view filter + sort
    # (WHERE current_stage = 'COMPLETED' ORDER BY completed_at DESC)
    op.create_index(
        'ix_shipments_stage_completed_at',
        'shipments',
        ['current_stage', 'completed_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_shipments_stage_completed_at', table_name='shipments')
