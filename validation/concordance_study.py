"""FIRMS smoke_pressure vs CAMS PM2.5 concordance study helpers.

Pure-Python Spearman rank correlation (no SciPy). CI runs on synthetic pairs;
optional live sampling is left for a local script invocation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from api.engine.air import Concordance, classify_concordance


def spearman_rank(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Spearman rank correlation coefficient. Returns 0.0 if undefined."""
    n = len(xs)
    if n != len(ys) or n < 2:
        return 0.0

    def ranks(vals: Sequence[float]) -> list[float]:
        ordered = sorted((v, i) for i, v in enumerate(vals))
        out = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and ordered[j + 1][0] == ordered[i][0]:
                j += 1
            avg = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                out[ordered[k][1]] = avg
            i = j + 1
        return out

    rx, ry = ranks(xs), ranks(ys)
    mean_x = sum(rx) / n
    mean_y = sum(ry) / n
    num = sum((a - mean_x) * (b - mean_y) for a, b in zip(rx, ry))
    den_x = sum((a - mean_x) ** 2 for a in rx) ** 0.5
    den_y = sum((b - mean_y) ** 2 for b in ry) ** 0.5
    if den_x == 0 or den_y == 0:
        return 0.0
    return num / (den_x * den_y)


@dataclass
class ConcordanceStudyResult:
    n: int
    spearman: float
    agree: int
    firms_leads: int
    model_leads: int

    @property
    def distribution(self) -> dict[str, float]:
        if self.n == 0:
            return {"AGREE": 0.0, "FIRMS_LEADS": 0.0, "MODEL_LEADS": 0.0}
        return {
            "AGREE": self.agree / self.n,
            "FIRMS_LEADS": self.firms_leads / self.n,
            "MODEL_LEADS": self.model_leads / self.n,
        }


def run_concordance_study(
    smoke_pressures: Sequence[float],
    us_aqis: Sequence[float],
) -> ConcordanceStudyResult:
    assert len(smoke_pressures) == len(us_aqis)
    states = [
        classify_concordance(s, a) for s, a in zip(smoke_pressures, us_aqis)
    ]
    return ConcordanceStudyResult(
        n=len(states),
        spearman=round(spearman_rank(list(smoke_pressures), list(us_aqis)), 4),
        agree=sum(1 for s in states if s == Concordance.AGREE),
        firms_leads=sum(1 for s in states if s == Concordance.FIRMS_LEADS),
        model_leads=sum(1 for s in states if s == Concordance.MODEL_LEADS),
    )


def synthetic_sample(n: int = 60) -> ConcordanceStudyResult:
    """Deterministic ~60 location-day synthetic sample for CI."""
    smoke: list[float] = []
    aqi: list[float] = []
    for i in range(n):
        # Mostly correlated, with some FIRMS_LEADS and MODEL_LEADS injected
        base = (i % 10) * 8.0
        smoke.append(base)
        aqi.append(base * 2.5 + 20.0)
    # Inject disagreements
    smoke[0], aqi[0] = 50.0, 30.0  # FIRMS_LEADS
    smoke[1], aqi[1] = 5.0, 160.0  # MODEL_LEADS
    smoke[2], aqi[2] = 60.0, 40.0  # FIRMS_LEADS
    smoke[3], aqi[3] = 2.0, 180.0  # MODEL_LEADS
    return run_concordance_study(smoke, aqi)
