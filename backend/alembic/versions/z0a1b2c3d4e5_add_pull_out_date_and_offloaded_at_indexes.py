"""add indexes on shipments.pull_out_date and containers.offloaded_at

Revision ID: z0a1b2c3d4e5
Revises: y9z0a1b2c3d4
Create Date: 2026-06-24

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'z0a1b2c3d4e5'
down_revision: Union[str, tuple, None] = 'y9z0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Default sort column on the active BL list — every page load hits this
    op.create_index('ix_shipments_pull_out_date', 'shipments', ['pull_out_date'])
    # Used by the historical BL date range filter on container offloading date
    op.create_index('ix_containers_offloaded_at', 'containers', ['offloaded_at'])


def downgrade() -> None:
    op.drop_index('ix_containers_offloaded_at', table_name='containers')
    op.drop_index('ix_shipments_pull_out_date', table_name='shipments')
