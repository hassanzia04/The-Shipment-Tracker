"""add actual_pull_out_date and offloaded_at to containers

Revision ID: e9f0a1b2c3d4
Revises: d4e5f6a7b8c9
Create Date: 2026-06-07

"""
from typing import Union
import sqlalchemy as sa
from alembic import op

revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('containers', sa.Column('actual_pull_out_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('containers', sa.Column('offloaded_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('containers', 'offloaded_at')
    op.drop_column('containers', 'actual_pull_out_date')
