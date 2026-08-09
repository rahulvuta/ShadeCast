"""Add sensitivity_profile to assessment_cache unique key.

Revision ID: d8f3b2c1a0e9
Revises: c7e2a91f04b1
Create Date: 2026-08-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d8f3b2c1a0e9"
down_revision: Union[str, None] = "c7e2a91f04b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assessment_cache",
        sa.Column(
            "sensitivity_profile",
            sa.String(length=32),
            nullable=False,
            server_default="general",
        ),
    )
    op.drop_constraint("uq_assessment", "assessment_cache", type_="unique")
    op.create_unique_constraint(
        "uq_assessment",
        "assessment_cache",
        ["lat_round", "lon_round", "workload", "acclimatized", "sensitivity_profile"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_assessment", "assessment_cache", type_="unique")
    op.create_unique_constraint(
        "uq_assessment",
        "assessment_cache",
        ["lat_round", "lon_round", "workload", "acclimatized"],
    )
    op.drop_column("assessment_cache", "sensitivity_profile")
