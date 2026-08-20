"""Storm hazard class — independent hard-stop, not a smooth load_score term.

Like wind gusts: a binary outdoor-work stop, never averaged into the score.

NWS active alerts (US) are filtered to the occupationally relevant set and
ranked using the alert's own severity, urgency, and certainty fields.

Open-Meteo convective signals cover locations outside NWS:

- precipitation_probability and wind_gusts_10m (always present)
- cape (J/kg) — present on the GFS hourly feed we already use
- thunderstorm_probability — requested in probes for Phoenix, Seattle, and
  Oaxaca; the field is advertised but returned null. Do not rely on it.

Rules:
- Tornado Warning or Severe Thunderstorm Warning → immediate STOP.
- Lightning risk above threshold → STOP. Lightning is binary.
- Watches escalate one verdict level and add a deterioration note; no hard-stop.
- Extreme Heat Warning and Air Quality Alert are surfaced as official alerts
  but do not themselves set the storm hard-stop (heat/air engines own those).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Sequence

from api.clients.nws import NwsAlert
from api.engine.weather import HEAVY_RAIN_CODES, SNOW_CODES, THUNDER_CODES

# Official event names we keep. Matching is case-insensitive substring.
RELEVANT_NEEDLES = (
    "tornado",
    "severe thunderstorm",
    "flash flood",
    "high wind",
    "extreme heat",
    "air quality",
    "winter storm",
)

HARD_STOP_EVENTS = frozenset(
    {
        "tornado warning",
        "severe thunderstorm warning",
    }
)

WATCH_NEEDLE = "watch"

# CAPE (J/kg) + precip probability as a global lightning proxy.
# thunderstorm_probability is unused (null in probed GFS responses).
LIGHTNING_CAPE_J = 1500.0
LIGHTNING_PRECIP_PCT = 50.0

WATCH_NOTE = "conditions may deteriorate rapidly"

_SEV = {"extreme": 4, "severe": 3, "moderate": 2, "minor": 1, "unknown": 0}
_URG = {"immediate": 3, "expected": 2, "future": 1, "past": 0, "unknown": 0}
_CERT = {"observed": 3, "likely": 2, "possible": 1, "unlikely": 0, "unknown": 0}


class StormBand(str, Enum):
    NONE = "NONE"
    WATCH = "WATCH"
    WARNING = "WARNING"
    HARD_STOP = "HARD_STOP"


@dataclass(frozen=True)
class StormAlertView:
    alert_id: str
    event: str
    severity: str | None
    urgency: str | None
    certainty: str | None
    onset: datetime | None
    expires: datetime | None
    headline: str | None
    description: str | None
    area: str | None
    web: str | None
    is_warning: bool
    is_watch: bool
    rank: int


@dataclass(frozen=True)
class StormAssessment:
    storm_band: StormBand
    lightning_risk: bool
    hard_stop: bool
    active_alerts: list[StormAlertView]
    watch_note: str | None
    headline_quote: str | None
    headline_event: str | None
    source: str  # "nws" | "open-meteo" | "none"
    hazard_class: str | None = None
    hazard_classes: tuple[str, ...] = ()


def _norm(event: str) -> str:
    return " ".join((event or "").lower().split())


def is_relevant_event(event: str) -> bool:
    e = _norm(event)
    return any(needle in e for needle in RELEVANT_NEEDLES)


def is_hard_stop_event(event: str) -> bool:
    return _norm(event) in HARD_STOP_EVENTS


def is_watch_event(event: str) -> bool:
    e = _norm(event)
    return is_relevant_event(event) and WATCH_NEEDLE in e and "warning" not in e


def is_warning_event(event: str) -> bool:
    e = _norm(event)
    if not is_relevant_event(event):
        return False
    return "warning" in e or e == "air quality alert"


def alert_rank(alert: NwsAlert) -> int:
    """Combine NWS severity / urgency / certainty into a comparable integer."""
    sev = _SEV.get((alert.severity or "unknown").lower(), 0)
    urg = _URG.get((alert.urgency or "unknown").lower(), 0)
    cert = _CERT.get((alert.certainty or "unknown").lower(), 0)
    return sev * 10 + urg * 3 + cert


def _view(alert: NwsAlert) -> StormAlertView:
    return StormAlertView(
        alert_id=alert.alert_id,
        event=alert.event,
        severity=alert.severity,
        urgency=alert.urgency,
        certainty=alert.certainty,
        onset=alert.onset,
        expires=alert.expires,
        headline=alert.headline,
        description=alert.description,
        area=alert.area,
        web=alert.web,
        is_warning=is_warning_event(alert.event),
        is_watch=is_watch_event(alert.event),
        rank=alert_rank(alert),
    )


def nws_hazard_class(event: str) -> str | None:
    """Map an NWS event name to a crew-precaution class."""
    e = _norm(event)
    if "tornado" in e:
        return "tornado"
    if "thunderstorm" in e:
        return "lightning"
    if "flash flood" in e or "flood" in e:
        return "flood"
    if "high wind" in e:
        return "wind"
    if "winter" in e:
        return "winter"
    if "extreme heat" in e or "air quality" in e:
        return "display"
    return None


def alerts_active_at(
    alerts: Sequence[NwsAlert] | None,
    when: datetime | None,
) -> list[NwsAlert]:
    """Keep alerts whose onset/expires window covers `when`. Missing bounds stay in."""
    rows = list(alerts or [])
    if when is None:
        return rows
    at = when if when.tzinfo is not None else when.replace(tzinfo=timezone.utc)
    out: list[NwsAlert] = []
    for a in rows:
        onset = a.onset
        expires = a.expires
        if onset is not None:
            start = onset if onset.tzinfo is not None else onset.replace(tzinfo=timezone.utc)
            if at < start:
                continue
        if expires is not None:
            end = expires if expires.tzinfo is not None else expires.replace(tzinfo=timezone.utc)
            if at >= end:
                continue
        out.append(a)
    return out


def storm_from_weathercode(code: int | None) -> tuple[StormBand, bool, str | None]:
    """Open-Meteo WMO weathercode → band, lightning flag, hazard class."""
    if code is None:
        return StormBand.NONE, False, None
    try:
        c = int(code)
    except (TypeError, ValueError):
        return StormBand.NONE, False, None
    if c in THUNDER_CODES:
        return StormBand.HARD_STOP, True, "lightning"
    if c in HEAVY_RAIN_CODES:
        return StormBand.WARNING, False, "flood"
    if c in SNOW_CODES:
        return StormBand.WARNING, False, "winter"
    return StormBand.NONE, False, None


def lightning_from_model(
    *,
    cape: float | None,
    precipitation_probability: float | None,
) -> bool:
    """Binary lightning risk from Open-Meteo convective fields.

    thunderstorm_probability is not used: probes returned null at US and
    non-US sites. CAPE ≥ 1500 J/kg with precip probability ≥ 50% is the
    documented proxy.
    """
    if cape is None or precipitation_probability is None:
        return False
    return cape >= LIGHTNING_CAPE_J and precipitation_probability >= LIGHTNING_PRECIP_PCT


_MODEL_HEADLINE = {
    "lightning": "Thunderstorm (Open-Meteo)",
    "flood": "Heavy rain (Open-Meteo)",
    "winter": "Snow (Open-Meteo)",
}


def assess_storm(
    alerts: Sequence[NwsAlert] | None = None,
    *,
    cape: float | None = None,
    precipitation_probability: float | None = None,
    wind_gusts_kmh: float | None = None,
    weathercode: int | None = None,
) -> StormAssessment:
    """Return storm_band / lightning_risk / active_alerts for one hour.

    NWS alerts, when present, own the band. Open-Meteo weathercode + CAPE
    fill in when NWS is missing, and model lightning still applies if there
    is no tornado/severe-thunderstorm warning.
    """
    _ = wind_gusts_kmh
    relevant = [_view(a) for a in (alerts or []) if is_relevant_event(a.event)]
    relevant.sort(key=lambda a: -a.rank)

    nws_hard = any(is_hard_stop_event(a.event) for a in relevant)
    nws_watch = any(a.is_watch for a in relevant)
    nws_warning = any(a.is_warning and nws_hazard_class(a.event) != "display" for a in relevant)
    nws_convective_warning = any(
        is_hard_stop_event(a.event) for a in relevant
    )

    wx_band, wx_lightning, wx_class = storm_from_weathercode(weathercode)
    model_lightning = lightning_from_model(
        cape=cape, precipitation_probability=precipitation_probability
    ) or wx_lightning
    nws_lightning = any(_norm(a.event) == "severe thunderstorm warning" for a in relevant)
    lightning = nws_lightning or (model_lightning if not nws_convective_warning else nws_lightning)
    hard_stop = nws_hard or lightning

    classes: list[str] = []
    for a in relevant:
        cls = nws_hazard_class(a.event)
        if cls and cls != "display" and cls not in classes:
            classes.append(cls)
    if wx_class and wx_class not in classes:
        if not relevant or wx_class == "lightning":
            classes.append(wx_class)

    if hard_stop:
        band = StormBand.HARD_STOP
    elif nws_warning or (wx_band == StormBand.WARNING and not relevant):
        band = StormBand.WARNING
    elif nws_watch:
        band = StormBand.WATCH
    elif wx_band == StormBand.HARD_STOP:
        band = StormBand.HARD_STOP
    else:
        band = StormBand.NONE

    quote = None
    quote_event = None
    for a in relevant:
        if is_hard_stop_event(a.event) and a.headline:
            quote = a.headline
            quote_event = a.event
            break
    if quote is None and relevant and relevant[0].headline:
        quote = relevant[0].headline
        quote_event = relevant[0].event
    if quote is None and wx_class and not relevant:
        quote = _MODEL_HEADLINE.get(wx_class)
        quote_event = wx_class

    if relevant:
        source = "nws"
    elif model_lightning or wx_band != StormBand.NONE:
        source = "open-meteo"
    else:
        source = "none"
    watch_note = WATCH_NOTE if nws_watch and not nws_hard else None
    primary = classes[0] if classes else None

    return StormAssessment(
        storm_band=band,
        lightning_risk=lightning,
        hard_stop=hard_stop,
        active_alerts=relevant,
        watch_note=watch_note,
        headline_quote=quote,
        headline_event=quote_event,
        source=source,
        hazard_class=primary,
        hazard_classes=tuple(classes),
    )
