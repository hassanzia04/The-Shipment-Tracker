"""merge heads

Revision ID: a9c1d2e3f4b5
Revises: e8c2a7f1d930, f3a8b2e1d0c5
Create Date: 2026-06-04 15:00:00.000000

"""
from typing import Sequence, Union

revision: str = 'a9c1d2e3f4b5'
down_revision: Union[str, None] = ('e8c2a7f1d930', 'f3a8b2e1d0c5')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
