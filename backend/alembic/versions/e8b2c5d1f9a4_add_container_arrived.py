"""add container arrived_at and CONTAINER_ARRIVED event type

Revision ID: e8b2c5d1f9a4
Revises: d4f71a3b9c02
Create Date: 2026-06-04 12:00:00.000000

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = 'e8b2c5d1f9a4'
down_revision: Union[str, None] = 'd4f71a3b9c02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('containers', sa.Column('arrived_at', sa.DateTime(timezone=True), nullable=True))
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'CONTAINER_ARRIVED'")


def downgrade() -> None:
    op.drop_column('containers', 'arrived_at')
    # Cannot remove enum values in PostgreSQL
