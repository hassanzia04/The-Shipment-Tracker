"""DN documents changed to BL-level (clear container_id on existing records)

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
Create Date: 2026-06-10
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'm7n8o9p0q1r2'
down_revision: Union[str, None] = 'l6m7n8o9p0q1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DN documents are now per-BL (AMLS only) rather than per-container.
    # Clear the container_id FK on any existing DN records so they become shipment-level.
    op.execute("UPDATE documents SET container_id = NULL WHERE doc_type = 'DN'")


def downgrade() -> None:
    pass  # Cannot recover per-container association after nullification
