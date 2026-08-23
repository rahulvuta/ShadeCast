# POWER probe notes

Dated probe. Climatology only. `time-standard=LST`. The production fetch in `api/clients/power.py` does not send an API key.

- lat=34.05, lon=-117.25
- start=20260803, end=20260804
- parameters=T2M,RH2M,WS10M,WD10M
- time-standard=LST

## Top-level keys
- ['geometry', 'header', 'messages', 'parameters', 'properties', 'times', 'type']

## header
- keys: ['api', 'end', 'fill_value', 'sources', 'start', 'time_standard', 'title']

## geometry
- {'type': 'Point', 'coordinates': [-117.25, 34.05, 628.09]}

## properties.parameter keys
- ['RH2M', 'T2M', 'WD10M', 'WS10M']
- sample value counts: {'T2M': 48, 'RH2M': 48, 'WS10M': 48, 'WD10M': 48}
