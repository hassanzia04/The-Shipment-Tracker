"""add hold_entity and hold_reason to shipment_events

Revision ID: e5f6a7b8c9d0
Revises: d3e4f5a6b7c8
Create Date: 2026-06-05 14:00:00.000000

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shipment_events',
        sa.Column('hold_entity', sa.Enum(name='external_entity_enum'), nullable=True))
    op.add_column('shipment_events',
        sa.Column('hold_reason', sa.Enum(name='hold_reason_enum'), nullable=True))


def downgrade() -> None:
    op.drop_column('shipment_events', 'hold_reason')
    op.drop_column('shipment_events', 'hold_entity')
