"""add daily_report_config and daily_report_recipients tables

To apply: docker compose exec backend alembic upgrade head

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Branch Labels: None
Depends On: None

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'daily_report_config',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('send_time', sa.String(5), nullable=False, server_default='17:30'),
        sa.Column('last_sent_date', sa.Date, nullable=True),
    )

    op.create_table(
        'daily_report_recipients',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('daily_report_recipients')
    op.drop_table('daily_report_config')
