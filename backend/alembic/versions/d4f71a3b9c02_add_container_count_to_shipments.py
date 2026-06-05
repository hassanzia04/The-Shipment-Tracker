"""add container_count to shipments

Revision ID: d4f71a3b9c02
Revises: c5d83e2f1b90
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = 'd4f71a3b9c02'
down_revision: Union[str, None] = 'c5d83e2f1b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shipments', sa.Column('container_count', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('shipments', 'container_count')
