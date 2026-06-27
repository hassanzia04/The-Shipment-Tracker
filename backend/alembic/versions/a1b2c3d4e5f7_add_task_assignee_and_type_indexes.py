"""add indexes on shipment_tasks.assigned_to_id and task_type

Revision ID: a1b2c3d4e5f7
Revises: z0a1b2c3d4e5
Create Date: 2026-06-25

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, tuple, None] = 'z0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PRO queue EXISTS subquery filters on (assigned_to_id, task_type, status) — all three needed
    op.create_index('ix_shipment_tasks_assigned_to_id', 'shipment_tasks', ['assigned_to_id'])
    op.create_index('ix_shipment_tasks_task_type', 'shipment_tasks', ['task_type'])
    # Composite covers the PRO queue filter and bulk hold/upload lookups in one index scan
    op.create_index(
        'ix_shipment_tasks_assignee_type_status',
        'shipment_tasks',
        ['assigned_to_id', 'task_type', 'status'],
    )


def downgrade() -> None:
    op.drop_index('ix_shipment_tasks_assignee_type_status', table_name='shipment_tasks')
    op.drop_index('ix_shipment_tasks_task_type', table_name='shipment_tasks')
    op.drop_index('ix_shipment_tasks_assigned_to_id', table_name='shipment_tasks')
