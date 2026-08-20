"""WMO weathercode labels and humidity bands for hourly crew conditions.

Built against docs/api_samples/open_meteo_weathercode_sample.json.
Codes follow the WMO WW interpretation Open-Meteo documents.
"""

from __future__ import annotations

from typing import Literal

WeatherSource = Literal["nws", "open-meteo"]
HumidityBand = Literal["low", "moderate", "high"]

WMO_WEATHER_TEXT: dict[int, str] = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Icy fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Heavy freezing drizzle",
    61: "Rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Showers",
    81: "Showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with hail",
}

THUNDER_CODES = frozenset({95, 96, 99})
HEAVY_RAIN_CODES = frozenset({65, 82})
SNOW_CODES = frozenset({71, 73, 75, 77, 85, 86})


def humidity_band(rh: float | None) -> HumidityBand | None:
    if rh is None:
        return None
    if rh < 40.0:
        return "low"
    if rh <= 70.0:
        return "moderate"
    return "high"


def weather_label(
    *,
    weathercode: int | None,
    nws_short_forecast: str | None = None,
) -> tuple[str | None, WeatherSource | None]:
    """Prefer NWS shortForecast; otherwise map Open-Meteo WMO weathercode."""
    text = (nws_short_forecast or "").strip()
    if text:
        return text, "nws"
    if weathercode is None:
        return None, None
    try:
        code = int(weathercode)
    except (TypeError, ValueError):
        return None, None
    mapped = WMO_WEATHER_TEXT.get(code)
    if mapped is None:
        mapped = f"Weather code {code}"
    return mapped, "open-meteo"
