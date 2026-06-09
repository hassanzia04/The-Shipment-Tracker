"""add is_amls flag to offloading_points and seed AMLS entry

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8
Create Date: 2026-06-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'j4k5l6m7n8o9'
down_revision: Union[str, tuple, None] = 'i3j4k5l6m7n8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('offloading_points', sa.Column('is_amls', sa.Boolean(), nullable=False, server_default='false'))
    # Insert AMLS if not present; if it already exists, mark it as is_amls=true
    op.execute("""
        INSERT INTO offloading_points (id, name, is_amls, is_active, created_at)
        VALUES (gen_random_uuid(), 'AMLS', true, true, NOW())
        ON CONFLICT (name) DO UPDATE SET is_amls = true
    """)


def downgrade() -> None:
    op.execute("DELETE FROM offloading_points WHERE name = 'AMLS' AND is_amls = true")
    op.drop_column('offloading_points', 'is_amls')
