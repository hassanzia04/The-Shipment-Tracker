"""add amls_job_number to shipments

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-06-07

"""
from typing import Union
import sqlalchemy as sa
from alembic import op

revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, None] = 'e9f0a1b2c3d4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('shipments', sa.Column('amls_job_number', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('shipments', 'amls_job_number')
