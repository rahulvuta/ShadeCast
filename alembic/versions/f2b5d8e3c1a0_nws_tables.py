"""Add NWS grid cache, alerts, and hourly observation tables.

Revision ID: f2b5d8e3c1a0
Revises: e1a4c9d2b0f7
Create Date: 2026-08-17
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2b5d8e3c1a0"
down_revision: Union[str, None] = "e1a4c9d2b0f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "nws_grid_cache",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("lat_round", sa.Float(), nullable=False),
        sa.Column("lon_round", sa.Float(), nullable=False),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("office", sa.String(length=8), nullable=True),
        sa.Column("grid_x", sa.Integer(), nullable=True),
        sa.Column("grid_y", sa.Integer(), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("city", sa.String(length=128), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lat_round", "lon_round", name="uq_nws_grid_cache"),
    )
    op.create_index("ix_nws_grid_loc", "nws_grid_cache", ["lat_round", "lon_round"])

    op.create_table(
        "nws_alerts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("alert_id", sa.String(length=256), nullable=False),
        sa.Column("lat_round", sa.Float(), nullable=False),
        sa.Column("lon_round", sa.Float(), nullable=False),
        sa.Column("event", sa.String(length=128), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=True),
        sa.Column("urgency", sa.String(length=32), nullable=True),
        sa.Column("certainty", sa.String(length=32), nullable=True),
        sa.Column("onset", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires", sa.DateTime(timezone=True), nullable=True),
        sa.Column("headline", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("area", sa.Text(), nullable=True),
        sa.Column("web", sa.String(length=512), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("alert_id", "lat_round", "lon_round", name="uq_nws_alert_loc"),
    )
    op.create_index("ix_nws_alerts_loc", "nws_alerts", ["lat_round", "lon_round"])

    op.create_table(
        "nws_observations_hours",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("lat_round", sa.Float(), nullable=False),
        sa.Column("lon_round", sa.Float(), nullable=False),
        sa.Column("valid_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("temperature_c", sa.Float(), nullable=True),
        sa.Column("relative_humidity", sa.Float(), nullable=True),
        sa.Column("dewpoint_c", sa.Float(), nullable=True),
        sa.Column("wind_speed_kmh", sa.Float(), nullable=True),
        sa.Column("wind_direction_deg", sa.Float(), nullable=True),
        sa.Column("precipitation_probability", sa.Float(), nullable=True),
        sa.Column("short_forecast", sa.String(length=128), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "lat_round", "lon_round", "valid_at", name="uq_nws_observation_hour"
        ),
    )
    op.create_index(
        "ix_nws_obs_loc_time",
        "nws_observations_hours",
        ["lat_round", "lon_round", "valid_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_nws_obs_loc_time", table_name="nws_observations_hours")
    op.drop_table("nws_observations_hours")
    op.drop_index("ix_nws_alerts_loc", table_name="nws_alerts")
    op.drop_table("nws_alerts")
    op.drop_index("ix_nws_grid_loc", table_name="nws_grid_cache")
    op.drop_table("nws_grid_cache")
