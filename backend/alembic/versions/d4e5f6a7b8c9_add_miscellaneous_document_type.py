"""add MISCELLANEOUS document type

Revision ID: d4e5f6a7b8c9
Revises: c1d2e3f4g5h6
Branch Labels: None
Depends On: None

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c1d2e3f4g5h6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE doc_type_enum ADD VALUE IF NOT EXISTS 'MISCELLANEOUS'")


def downgrade() -> None:
    pass  # PostgreSQL does not support removing enum values
