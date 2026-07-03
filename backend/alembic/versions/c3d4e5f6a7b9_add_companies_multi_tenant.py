"""add companies table and company_id for multi-tenant support

Revision ID: c3d4e5f6a7b9
Revises: b2c3d4e5f6a8
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'c3d4e5f6a7b9'
down_revision: Union[str, tuple, None] = 'b2c3d4e5f6a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'companies',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), unique=True, nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # Seed the existing customer's company and backfill all current data into it
    op.execute("INSERT INTO companies (id, name, is_active, created_at) VALUES (gen_random_uuid(), 'MBRF', true, NOW())")

    op.add_column('users', sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=True))
    op.add_column('invitations', sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=True))
    op.add_column('shipments', sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=True))

    op.execute(
        "UPDATE users SET company_id = (SELECT id FROM companies WHERE name = 'MBRF') "
        "WHERE team IN ('CUSTOMER', 'CUSTOMER_MANAGEMENT')"
    )
    op.execute("UPDATE shipments SET company_id = (SELECT id FROM companies WHERE name = 'MBRF')")

    op.alter_column('shipments', 'company_id', nullable=False)
    op.create_index('ix_users_company_id', 'users', ['company_id'])
    op.create_index('ix_shipments_company_id', 'shipments', ['company_id'])


def downgrade() -> None:
    op.drop_index('ix_shipments_company_id', table_name='shipments')
    op.drop_index('ix_users_company_id', table_name='users')
    op.drop_column('shipments', 'company_id')
    op.drop_column('invitations', 'company_id')
    op.drop_column('users', 'company_id')
    op.drop_table('companies')
