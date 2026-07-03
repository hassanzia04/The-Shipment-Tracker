"""personal customer-focus preference for internal users

users.focus_company_ids: JSONB list of company id strings — the customers an
internal (e.g. FFD) user works with. Used as a default filter on the shipment
list and container view with a one-click "show all" escape. Purely a view
preference; grants or restricts nothing.

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, tuple, None] = 'c0d1e2f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('focus_company_ids', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'focus_company_ids')
