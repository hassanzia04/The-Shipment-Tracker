"""add alert_cc_configs table

To apply: docker compose exec backend alembic upgrade head

Revision ID: a1b2c3d4e5f6
Revises: f6a7b8c9d0e1
Branch Labels: None
Depends On: None

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'alert_cc_configs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('team', sa.String(20), nullable=True),
        sa.Column('pro_user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('cc_email', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(team IS NOT NULL AND pro_user_id IS NULL) OR (team IS NULL AND pro_user_id IS NOT NULL)",
            name="cc_config_target_check",
        ),
    )
    op.create_index('ix_alert_cc_configs_team', 'alert_cc_configs', ['team'])
    op.create_index('ix_alert_cc_configs_pro_user_id', 'alert_cc_configs', ['pro_user_id'])


def downgrade() -> None:
    op.drop_index('ix_alert_cc_configs_pro_user_id', table_name='alert_cc_configs')
    op.drop_index('ix_alert_cc_configs_team', table_name='alert_cc_configs')
    op.drop_table('alert_cc_configs')
