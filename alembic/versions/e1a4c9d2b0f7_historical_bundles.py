"""Add historical_bundles table for Time Machine cached payloads.

Revision ID: e1a4c9d2b0f7
Revises: d8f3b2c1a0e9
Create Date: 2026-08-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e1a4c9d2b0f7"
down_revision: Union[str, None] = "d8f3b2c1a0e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "historical_bundles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("start_date", sa.String(length=16), nullable=False),
        sa.Column("end_date", sa.String(length=16), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_historical_bundle_event"),
    )
    op.create_index("ix_historical_bundles_event_id", "historical_bundles", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_historical_bundles_event_id", table_name="historical_bundles")
    op.drop_table("historical_bundles")
