"""add driver_name_override to containers

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-06-20

"""
from alembic import op
import sqlalchemy as sa

revision = 'u5v6w7x8y9z0'
down_revision = 't4u5v6w7x8y9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('containers', sa.Column('driver_name_override', sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column('containers', 'driver_name_override')
