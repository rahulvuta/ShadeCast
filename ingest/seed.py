"""Seed assessment_cache for the three demo locations (offline DEMO_MODE).

Usage:
  poetry run python -m ingest.seed
"""

from __future__ import annotations

import logging

from api.config import DEMO_LOCATIONS
from api.db import SessionLocal
from api.services.assess import build_assessment

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ingest.seed")


def main() -> int:
    db = SessionLocal()
    try:
        for loc in DEMO_LOCATIONS:
            for workload in ("light", "moderate", "heavy"):
                for acclim in (False, True):
                    try:
                        resp = build_assessment(
                            db,
                            loc["lat"],
                            loc["lon"],
                            workload=workload,  # type: ignore[arg-type]
                            acclimatized=acclim,
                            allow_network=True,
                        )
                        logger.info(
                            "Seeded %s workload=%s acclim=%s verdict=%s",
                            loc["key"],
                            workload,
                            acclim,
                            resp.current.verdict,
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            "Seed failed %s/%s/%s: %s — trying cache-only",
                            loc["key"],
                            workload,
                            acclim,
                            exc,
                        )
                        build_assessment(
                            db,
                            loc["lat"],
                            loc["lon"],
                            workload=workload,  # type: ignore[arg-type]
                            acclimatized=acclim,
                            allow_network=False,
                        )
        logger.info("Seed complete. Set DEMO_MODE=1 to serve only from assessment_cache.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
