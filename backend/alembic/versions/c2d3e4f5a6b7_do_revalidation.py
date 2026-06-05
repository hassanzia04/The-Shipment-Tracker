"""add DO_REVALIDATION container status and revalidation_remark column

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-06-04 17:00:00.000000

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE container_status_enum ADD VALUE IF NOT EXISTS 'DO_REVALIDATION'")
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'DO_REVALIDATION_REQUESTED'")
    op.execute("ALTER TYPE event_type_enum ADD VALUE IF NOT EXISTS 'DO_REVALIDATED'")
    op.add_column('containers', sa.Column('revalidation_remark', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('containers', 'revalidation_remark')
