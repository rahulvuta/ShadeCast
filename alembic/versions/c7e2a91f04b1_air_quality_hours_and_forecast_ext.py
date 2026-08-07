"""air_quality_hours + forecast extensions

Revision ID: c7e2a91f04b1
Revises: b454555bb773
Create Date: 2026-08-06 22:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7e2a91f04b1"
down_revision: Union[str, None] = "b454555bb773"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "air_quality_hours",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("lat_round", sa.Float(), nullable=False),
        sa.Column("lon_round", sa.Float(), nullable=False),
        sa.Column("valid_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("pm2_5", sa.Float(), nullable=True),
        sa.Column("pm10", sa.Float(), nullable=True),
        sa.Column("us_aqi", sa.Float(), nullable=True),
        sa.Column("european_aqi", sa.Float(), nullable=True),
        sa.Column("dominant_pollutant", sa.String(length=32), nullable=True),
        sa.Column("uv_index", sa.Float(), nullable=True),
        sa.Column("uv_index_clear_sky", sa.Float(), nullable=True),
        sa.Column("dust", sa.Float(), nullable=True),
        sa.Column("aerosol_optical_depth", sa.Float(), nullable=True),
        sa.Column("ozone", sa.Float(), nullable=True),
        sa.Column("nitrogen_dioxide", sa.Float(), nullable=True),
        sa.Column("carbon_monoxide", sa.Float(), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lat_round", "lon_round", "valid_at", name="uq_air_quality_hour"),
    )
    op.create_index(
        "ix_air_quality_loc_time",
        "air_quality_hours",
        ["lat_round", "lon_round", "valid_at"],
        unique=False,
    )

    op.add_column("forecast_hours", sa.Column("wind_gusts_kmh", sa.Float(), nullable=True))
    op.add_column(
        "forecast_hours", sa.Column("precipitation_probability", sa.Float(), nullable=True)
    )
    op.add_column("forecast_hours", sa.Column("cloud_cover", sa.Float(), nullable=True))
    op.add_column(
        "forecast_hours", sa.Column("apparent_temperature_c", sa.Float(), nullable=True)
    )
    op.add_column("forecast_hours", sa.Column("uv_index", sa.Float(), nullable=True))
    op.add_column(
        "forecast_hours", sa.Column("uv_index_clear_sky", sa.Float(), nullable=True)
    )

    op.add_column(
        "ingest_runs",
        sa.Column("air_quality_upserted", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("ingest_runs", "air_quality_upserted")
    op.drop_column("forecast_hours", "uv_index_clear_sky")
    op.drop_column("forecast_hours", "uv_index")
    op.drop_column("forecast_hours", "apparent_temperature_c")
    op.drop_column("forecast_hours", "cloud_cover")
    op.drop_column("forecast_hours", "precipitation_probability")
    op.drop_column("forecast_hours", "wind_gusts_kmh")
    op.drop_index("ix_air_quality_loc_time", table_name="air_quality_hours")
    op.drop_table("air_quality_hours")
