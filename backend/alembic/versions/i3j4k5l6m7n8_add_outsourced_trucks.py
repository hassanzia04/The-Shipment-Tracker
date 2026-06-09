"""add outsourced_trucks table and OUTSOURCED_TRANSPORT container status

Revision ID: i3j4k5l6m7n8
Revises: h2i3j4k5l6m7
Create Date: 2026-06-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'i3j4k5l6m7n8'
down_revision: Union[str, tuple, None] = 'h2i3j4k5l6m7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'outsourced_trucks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('plate_number', sa.String(50), unique=True, nullable=False),
        sa.Column('driver_name', sa.String(255), nullable=False),
        sa.Column('contractor', sa.String(255), nullable=False),
        sa.Column('nationality', sa.String(100), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column('containers', sa.Column('outsourced_truck_id', UUID(as_uuid=True), sa.ForeignKey('outsourced_trucks.id'), nullable=True))
    op.add_column('containers', sa.Column('outsourced_expected_arrival_at', sa.DateTime(timezone=True), nullable=True))
    # Add new container status value
    op.execute("ALTER TYPE container_status_enum ADD VALUE IF NOT EXISTS 'OUTSOURCED_TRANSPORT'")


def downgrade() -> None:
    op.drop_column('containers', 'outsourced_expected_arrival_at')
    op.drop_column('containers', 'outsourced_truck_id')
    op.drop_table('outsourced_trucks')
