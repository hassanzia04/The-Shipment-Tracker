"""make invoice_number unique per company instead of globally

BL numbers stay globally unique (carrier-issued). Invoice numbers are generated
by each customer's own systems, so two companies may legitimately share one.

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a7b9
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, tuple, None] = 'c3d4e5f6a7b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('uq_shipments_invoice_number', 'shipments', type_='unique')
    op.create_unique_constraint('uq_shipments_company_invoice', 'shipments', ['company_id', 'invoice_number'])


def downgrade() -> None:
    # Fails if different companies now share an invoice number — resolve manually first
    op.drop_constraint('uq_shipments_company_invoice', 'shipments', type_='unique')
    op.create_unique_constraint('uq_shipments_invoice_number', 'shipments', ['invoice_number'])
