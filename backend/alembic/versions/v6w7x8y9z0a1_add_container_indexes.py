"""add indexes on containers.shipment_id, status, container_number

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-06-20

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'v6w7x8y9z0a1'
down_revision: Union[str, tuple, None] = 'u5v6w7x8y9z0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_containers_shipment_id', 'containers', ['shipment_id'])
    op.create_index('ix_containers_status', 'containers', ['status'])
    op.create_index('ix_containers_container_number', 'containers', ['container_number'])


def downgrade() -> None:
    op.drop_index('ix_containers_container_number', table_name='containers')
    op.drop_index('ix_containers_status', table_name='containers')
    op.drop_index('ix_containers_shipment_id', table_name='containers')
