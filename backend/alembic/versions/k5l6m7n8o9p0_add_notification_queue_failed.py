"""add queue_failed flag to notifications

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
Create Date: 2026-06-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'k5l6m7n8o9p0'
down_revision: Union[str, tuple, None] = 'j4k5l6m7n8o9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('notifications', sa.Column('queue_failed', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('notifications', 'queue_failed')
