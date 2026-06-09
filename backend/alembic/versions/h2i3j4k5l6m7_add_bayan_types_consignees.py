"""add bayan_types, consignees tables and new shipment fields

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-06-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'h2i3j4k5l6m7'
down_revision: Union[str, tuple, None] = 'g1h2i3j4k5l6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bayan_types',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), unique=True, nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        'consignees',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), unique=True, nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column('shipments', sa.Column('bayan_type_id', UUID(as_uuid=True), sa.ForeignKey('bayan_types.id'), nullable=True))
    op.add_column('shipments', sa.Column('eta_at_port', sa.Date(), nullable=True))
    op.add_column('shipments', sa.Column('consignee_id', UUID(as_uuid=True), sa.ForeignKey('consignees.id'), nullable=True))

    # Seed initial bayan types
    op.execute("INSERT INTO bayan_types (id, name, is_active, created_at) VALUES (gen_random_uuid(), 'Transfer', true, NOW())")
    op.execute("INSERT INTO bayan_types (id, name, is_active, created_at) VALUES (gen_random_uuid(), 'Bonded', true, NOW())")
    op.execute("INSERT INTO bayan_types (id, name, is_active, created_at) VALUES (gen_random_uuid(), 'Transit', true, NOW())")


def downgrade() -> None:
    op.drop_column('shipments', 'consignee_id')
    op.drop_column('shipments', 'eta_at_port')
    op.drop_column('shipments', 'bayan_type_id')
    op.drop_table('consignees')
    op.drop_table('bayan_types')
