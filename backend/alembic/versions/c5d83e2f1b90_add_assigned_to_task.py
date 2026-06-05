"""add assigned_to_id to shipment_tasks and task_assigned event

Revision ID: c5d83e2f1b90
Revises: a3f92c1d0e47
Create Date: 2026-06-03 13:00:00.000000

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = 'c5d83e2f1b90'
down_revision: Union[str, None] = 'a3f92c1d0e47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shipment_tasks', sa.Column('assigned_to_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_shipment_tasks_assigned_to', 'shipment_tasks', 'users',
        ['assigned_to_id'], ['id'],
    )
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'TASK_ASSIGNED'")


def downgrade() -> None:
    op.drop_constraint('fk_shipment_tasks_assigned_to', 'shipment_tasks', type_='foreignkey')
    op.drop_column('shipment_tasks', 'assigned_to_id')
    # Cannot remove enum values in PostgreSQL
