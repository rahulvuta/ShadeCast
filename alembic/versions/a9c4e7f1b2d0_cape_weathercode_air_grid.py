"""Persist CAPE/weathercode and CAMS air-quality grid cache.

Revision ID: a9c4e7f1b2d0
Revises: f2b5d8e3c1a0
Create Date: 2026-08-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9c4e7f1b2d0"
down_revision: Union[str, None] = "f2b5d8e3c1a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("forecast_hours", sa.Column("cape", sa.Float(), nullable=True))
    op.add_column("forecast_hours", sa.Column("weathercode", sa.Integer(), nullable=True))
    op.create_table(
        "air_quality_grid_cache",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("lat_round", sa.Float(), nullable=False),
        sa.Column("lon_round", sa.Float(), nullable=False),
        sa.Column("hour_key", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lat_round", "lon_round", "hour_key", name="uq_air_quality_grid"),
    )


def downgrade() -> None:
    op.drop_table("air_quality_grid_cache")
    op.drop_column("forecast_hours", "weathercode")
    op.drop_column("forecast_hours", "cape")
