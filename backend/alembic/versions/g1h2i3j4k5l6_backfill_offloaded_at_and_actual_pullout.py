"""backfill offloaded_at and actual_pull_out_date from container_events

Containers that were offloaded / had trucks assigned before the
e9f0a1b2c3d4 migration added these columns have NULL values.
This migration reads the timestamps from container_events to fill them in.

Revision ID: g1h2i3j4k5l6
Revises: f0a1b2c3d4e5
Create Date: 2026-06-07

"""
from typing import Union
from alembic import op

revision: str = 'g1h2i3j4k5l6'
down_revision: Union[str, None] = 'f0a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Backfill offloaded_at from the earliest OFFLOADED container event
    op.execute("""
        UPDATE containers c
        SET offloaded_at = (
            SELECT ce.created_at
            FROM container_events ce
            WHERE ce.container_id = c.id
              AND ce.event_type = 'OFFLOADED'
            ORDER BY ce.created_at ASC
            LIMIT 1
        )
        WHERE c.offloaded_at IS NULL
          AND c.status IN ('OFFLOADED', 'RETURNED', 'CLOSED')
    """)

    # Backfill actual_pull_out_date from the earliest TRUCK_ASSIGNED container event
    op.execute("""
        UPDATE containers c
        SET actual_pull_out_date = (
            SELECT ce.created_at
            FROM container_events ce
            WHERE ce.container_id = c.id
              AND ce.event_type = 'TRUCK_ASSIGNED'
            ORDER BY ce.created_at ASC
            LIMIT 1
        )
        WHERE c.actual_pull_out_date IS NULL
          AND c.truck_id IS NOT NULL
    """)


def downgrade() -> None:
    pass  # backfill is non-destructive; no meaningful way to reverse
