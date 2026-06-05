"""add DN and DC_HEALTH_CERT document types

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Branch Labels: None
Depends On: None

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE doc_type_enum ADD VALUE IF NOT EXISTS 'DN'")
    op.execute("ALTER TYPE doc_type_enum ADD VALUE IF NOT EXISTS 'DC_HEALTH_CERT'")


def downgrade() -> None:
    pass  # PostgreSQL does not support removing enum values
