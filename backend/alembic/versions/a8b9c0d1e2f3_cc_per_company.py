"""company-scoped CC lists for customer-team alerts

Customer-team CC entries now carry company_id so an address is only copied on
that company's emails. Existing CUSTOMER-team rows are backfilled to MBRF
(single-customer era), which restores the exact pre-multi-tenant behavior for
MBRF. Internal-team and per-PRO rows keep company_id NULL.

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, tuple, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('alert_cc_configs', sa.Column(
        'company_id', UUID(as_uuid=True),
        sa.ForeignKey('companies.id', ondelete='CASCADE'), nullable=True,
    ))
    op.create_index('ix_alert_cc_configs_company_id', 'alert_cc_configs', ['company_id'])
    op.execute("""
        UPDATE alert_cc_configs
        SET company_id = (SELECT id FROM companies WHERE name = 'MBRF')
        WHERE team IN ('CUSTOMER', 'CUSTOMER_MANAGEMENT') AND company_id IS NULL
    """)


def downgrade() -> None:
    op.drop_index('ix_alert_cc_configs_company_id', table_name='alert_cc_configs')
    op.drop_column('alert_cc_configs', 'company_id')
