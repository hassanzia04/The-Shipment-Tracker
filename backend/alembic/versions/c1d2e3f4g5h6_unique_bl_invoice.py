"""add unique constraints on bl_number and invoice_number

Merges heads a9c1d2e3f4b5 (container/ccro) and b2c3d4e5f6a7 (daily-report).

To apply:
  docker compose exec backend alembic upgrade head

Before running on an existing database, verify there are no duplicate values:
  SELECT bl_number, COUNT(*) FROM shipments GROUP BY bl_number HAVING COUNT(*) > 1;
  SELECT invoice_number, COUNT(*) FROM shipments GROUP BY invoice_number HAVING COUNT(*) > 1;

Revision ID: c1d2e3f4g5h6
Revises: a9c1d2e3f4b5, b2c3d4e5f6a7
Create Date: 2026-06-05

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'c1d2e3f4g5h6'
down_revision: Union[str, tuple, None] = ('a9c1d2e3f4b5', 'b2c3d4e5f6a7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint('uq_shipments_bl_number', 'shipments', ['bl_number'])
    op.create_unique_constraint('uq_shipments_invoice_number', 'shipments', ['invoice_number'])


def downgrade() -> None:
    op.drop_constraint('uq_shipments_invoice_number', 'shipments', type_='unique')
    op.drop_constraint('uq_shipments_bl_number', 'shipments', type_='unique')
