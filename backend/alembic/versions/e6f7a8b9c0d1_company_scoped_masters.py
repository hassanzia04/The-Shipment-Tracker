"""scope consignees, product types, and offloading points per company

NULL company_id = shared row visible to every company. Existing rows are
backfilled to MBRF, except AMLS offloading points which stay shared (they are
common warehouse infrastructure every customer delivers to).

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, tuple, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCOPED_TABLES = ('consignees', 'product_types', 'offloading_points')


def upgrade() -> None:
    for table in SCOPED_TABLES:
        op.add_column(table, sa.Column('company_id', UUID(as_uuid=True), sa.ForeignKey('companies.id'), nullable=True))
        op.create_index(f'ix_{table}_company_id', table, ['company_id'])

    # Backfill: everything created during the single-customer era belongs to MBRF,
    # except AMLS offloading points which stay shared infrastructure
    op.execute("UPDATE consignees SET company_id = (SELECT id FROM companies WHERE name = 'MBRF')")
    op.execute("UPDATE product_types SET company_id = (SELECT id FROM companies WHERE name = 'MBRF')")
    op.execute(
        "UPDATE offloading_points SET company_id = (SELECT id FROM companies WHERE name = 'MBRF') "
        "WHERE is_amls = false"
    )

    # Names: unique per company + unique among shared (NULL company) rows,
    # but allowed to repeat across different companies
    for table in SCOPED_TABLES:
        op.drop_constraint(f'{table}_name_key', table, type_='unique')
        op.create_unique_constraint(f'uq_{table}_company_name', table, ['company_id', 'name'])
        op.execute(
            f"CREATE UNIQUE INDEX uq_{table}_shared_name ON {table} (name) WHERE company_id IS NULL"
        )


def downgrade() -> None:
    # Fails if names now collide across companies — resolve manually first
    for table in SCOPED_TABLES:
        op.execute(f"DROP INDEX IF EXISTS uq_{table}_shared_name")
        op.drop_constraint(f'uq_{table}_company_name', table, type_='unique')
        op.create_unique_constraint(f'{table}_name_key', table, ['name'])
        op.drop_index(f'ix_{table}_company_id', table_name=table)
        op.drop_column(table, 'company_id')
