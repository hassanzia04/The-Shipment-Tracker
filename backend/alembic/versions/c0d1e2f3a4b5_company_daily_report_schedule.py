"""per-company daily report toggle and custom send time

companies gain daily_report_enabled (default true — recipients presence keeps
deciding whether anything is sent), daily_report_send_time (NULL = follow the
global time), and daily_report_last_sent_date (gates one send per day per
company so custom times work independently).

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, tuple, None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('companies', sa.Column('daily_report_enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('companies', sa.Column('daily_report_send_time', sa.String(5), nullable=True))
    op.add_column('companies', sa.Column('daily_report_last_sent_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('companies', 'daily_report_last_sent_date')
    op.drop_column('companies', 'daily_report_send_time')
    op.drop_column('companies', 'daily_report_enabled')
