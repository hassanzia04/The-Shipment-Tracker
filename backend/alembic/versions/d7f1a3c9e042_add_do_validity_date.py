"""add do_validity_date to shipments and do_validity_updated event

Revision ID: d7f1a3c9e042
Revises: c5d83e2f1b90
Create Date: 2026-06-03 14:00:00.000000

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = 'd7f1a3c9e042'
down_revision: Union[str, None] = 'c5d83e2f1b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shipments', sa.Column('do_validity_date', sa.Date(), nullable=True))
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'DO_VALIDITY_UPDATED'")


def downgrade() -> None:
    op.drop_column('shipments', 'do_validity_date')
    # Cannot remove enum values in PostgreSQL
