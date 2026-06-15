"""add performance indexes on frequently-filtered columns

Revision ID: q1r2s3t4u5v6
Revises: p0q1r2s3t4u5
Create Date: 2026-06-12
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'q1r2s3t4u5v6'
down_revision: Union[str, tuple, None] = 'p0q1r2s3t4u5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_shipments_current_stage', 'shipments', ['current_stage'])
    op.create_index('ix_shipment_events_shipment_id', 'shipment_events', ['shipment_id'])
    op.create_index('ix_shipment_events_event_type', 'shipment_events', ['event_type'])
    op.create_index('ix_shipment_tasks_shipment_id', 'shipment_tasks', ['shipment_id'])
    op.create_index('ix_shipment_tasks_status', 'shipment_tasks', ['status'])


def downgrade() -> None:
    op.drop_index('ix_shipment_tasks_status', table_name='shipment_tasks')
    op.drop_index('ix_shipment_tasks_shipment_id', table_name='shipment_tasks')
    op.drop_index('ix_shipment_events_event_type', table_name='shipment_events')
    op.drop_index('ix_shipment_events_shipment_id', table_name='shipment_events')
    op.drop_index('ix_shipments_current_stage', table_name='shipments')
