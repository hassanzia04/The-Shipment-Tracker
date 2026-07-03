"""per-company daily report recipients

daily_report_recipients gains company_id: NULL = the internal full report
(existing rows keep receiving it unchanged); set = that customer company's
scoped edition, sent only for companies that have at least one recipient.
Uniqueness moves from global email to (email, company) with a partial unique
index guarding the internal (NULL) list.

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'b9c0d1e2f3a4'
down_revision: Union[str, tuple, None] = 'a8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('daily_report_recipients', sa.Column(
        'company_id', UUID(as_uuid=True),
        sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=True,
    ))
    op.create_index('ix_daily_report_recipients_company_id', 'daily_report_recipients', ['company_id'])
    op.drop_constraint('daily_report_recipients_email_key', 'daily_report_recipients', type_='unique')
    op.create_unique_constraint(
        'uq_daily_report_recipients_email_company', 'daily_report_recipients', ['email', 'company_id'])
    op.execute(
        "CREATE UNIQUE INDEX uq_daily_report_recipients_email_internal "
        "ON daily_report_recipients (email) WHERE company_id IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_daily_report_recipients_email_internal")
    op.drop_constraint('uq_daily_report_recipients_email_company', 'daily_report_recipients', type_='unique')
    op.execute("DELETE FROM daily_report_recipients WHERE company_id IS NOT NULL")
    op.create_unique_constraint('daily_report_recipients_email_key', 'daily_report_recipients', ['email'])
    op.drop_index('ix_daily_report_recipients_company_id', table_name='daily_report_recipients')
    op.drop_column('daily_report_recipients', 'company_id')
