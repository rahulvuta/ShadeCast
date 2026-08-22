import type { FormEvent } from 'react'
import type { HistoricalEventSummary } from '../api'
import {
  CORRUPT_DEMO,
  DEMO_LOCATIONS,
  SENSITIVITY_PROFILES,
  type SensitivityProfile,
  type Workload,
} from '../types'

type ActiveLocation = { lat: number; lon: number; label: string }

type GeocodeHit = {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

function formatGeocodeLabel(h: GeocodeHit): string {
  return [h.name, h.admin1, h.country].filter(Boolean).join(', ')
}

export function SidebarControls({
  loc,
  corruptDemo,
  searchQuery,
  searchHits,
  searchBusy,
  searchError,
  latInput,
  lonInput,
  workload,
  profile,
  acclimatized,
  skinType,
  historicalEvents,
  activeEventId,
  hourOffset,
  idPrefix = 'sidebar',
  onSearchQuery,
  onLatInput,
  onLonInput,
  onWorkload,
  onProfile,
  onAcclimatized,
  onSkinType,
  onHourOffset,
  onApplyLocation,
  onSelectHistoricalEvent,
  onRunSearch,
  onGoLatLon,
}: {
  loc: ActiveLocation | null
  corruptDemo: boolean
  searchQuery: string
  searchHits: GeocodeHit[]
  searchBusy: boolean
  searchError: string | null
  latInput: string
  lonInput: string
  workload: Workload
  profile: SensitivityProfile
  acclimatized: boolean
  skinType: number
  historicalEvents: HistoricalEventSummary[]
  activeEventId: string | null
  hourOffset: number | null
  idPrefix?: string
  onSearchQuery: (v: string) => void
  onLatInput: (v: string) => void
  onLonInput: (v: string) => void
  onWorkload: (v: Workload) => void
  onProfile: (v: SensitivityProfile) => void
  onAcclimatized: (v: boolean) => void
  onSkinType: (v: number) => void
  onHourOffset: (v: number | null) => void
  onApplyLocation: (next: ActiveLocation) => void
  onSelectHistoricalEvent: (eventId: string | null) => void
  onRunSearch: (e?: FormEvent) => void
  onGoLatLon: (e?: FormEvent) => void
}) {
  const field =
    'touch-target mt-1 w-full rounded border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-sm'
  const searchId = `${idPrefix}-place-search`
  const skinLabels = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

  return (
    <nav aria-label="Location and settings" className="space-y-3">
      <div>
        <p className="dash-section-label mb-1.5">Quick demos (live)</p>
        <div className="flex flex-wrap gap-1.5">
          {[...DEMO_LOCATIONS, ...(corruptDemo ? [CORRUPT_DEMO] : [])].map((d) => {
            const active =
              loc != null &&
              !activeEventId &&
              Math.abs(loc.lat - d.lat) < 0.01 &&
              Math.abs(loc.lon - d.lon) < 0.01
            return (
              <button
                key={d.key}
                type="button"
                className={`touch-target rounded border px-2.5 py-1.5 text-xs font-semibold ${
                  active
                    ? 'btn-selected'
                    : 'border-[var(--border)] bg-[var(--chip-bg)] hover:border-[var(--ink)]'
                }`}
                onClick={() => onApplyLocation({ lat: d.lat, lon: d.lon, label: d.label })}
              >
                {d.label.split(' (')[0]}
              </button>
            )
          })}
        </div>
      </div>

      {historicalEvents.length > 0 && (
        <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-2.5">
          <p className="dash-section-label mb-1.5">Time Machine (historical)</p>
          <p className="mb-2 text-[0.65rem] leading-snug text-[var(--muted)]">
            Replay archived weather and air quality through the same engine as live.
          </p>
          <label className="block text-xs font-semibold">
            Event
            <select
              className={field}
              value={activeEventId ?? ''}
              onChange={(e) => onSelectHistoricalEvent(e.target.value || null)}
            >
              <option value="">Live mode</option>
              {historicalEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.label}
                </option>
              ))}
            </select>
          </label>
          {activeEventId && (
            <label className="mt-2 block text-xs font-semibold">
              Archive hour index
              <input
                type="number"
                min={0}
                max={200}
                className={field}
                value={hourOffset ?? 0}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  onHourOffset(Number.isFinite(n) ? Math.max(0, Math.min(200, Math.round(n))) : 0)
                }}
              />
              <span className="mt-1 block text-[0.65rem] font-normal text-[var(--muted)]">
                Hour index into the archived bundle (0 = event start). Live mode re-assesses the
                current coordinates.
              </span>
            </label>
          )}
        </div>
      )}

      <form onSubmit={(e) => void onRunSearch(e)} className="space-y-1.5">
        <label className="block text-xs font-semibold" htmlFor={searchId}>
          Search / coordinates
        </label>
        <div className="flex gap-1.5">
          <input
            id={searchId}
            className={`${field} min-w-0 flex-1 !mt-0`}
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            placeholder="City or town"
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn-primary touch-target shrink-0 rounded px-3 text-xs font-semibold disabled:opacity-50"
            disabled={searchBusy}
          >
            {searchBusy ? '…' : 'Go'}
          </button>
        </div>
        {searchError && <p className="text-xs text-[var(--oi-vermillion)]">{searchError}</p>}
        {searchHits.length > 0 && (
          <ul className="rounded border border-[var(--border)] divide-y divide-[var(--border)]">
            {searchHits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="touch-target w-full px-2.5 py-2 text-left text-xs hover:bg-[var(--panel)]"
                  onClick={() =>
                    onApplyLocation({
                      lat: h.latitude,
                      lon: h.longitude,
                      label: formatGeocodeLabel(h),
                    })
                  }
                >
                  {formatGeocodeLabel(h)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <form onSubmit={onGoLatLon} className="grid grid-cols-2 gap-1.5">
        <label className="block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Lat
          <input
            type="number"
            step="any"
            className={field}
            value={latInput}
            onChange={(e) => onLatInput(e.target.value)}
          />
        </label>
        <label className="block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Lon
          <input
            type="number"
            step="any"
            className={field}
            value={lonInput}
            onChange={(e) => onLonInput(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="touch-target col-span-2 rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:border-[var(--ink)]"
        >
          Go to coordinates
        </button>
      </form>

      {loc ? (
        <p className="text-[0.7rem] text-[var(--muted)] leading-snug">
          Active: <strong className="text-[var(--ink)]">{loc.label}</strong>
          <br />
          {loc.lat.toFixed(3)}, {loc.lon.toFixed(3)}
          {activeEventId ? ' · historical' : ''}
        </p>
      ) : (
        <p className="text-[0.7rem] text-[var(--muted)] leading-snug">
          No location selected — pick a demo, search, or enter coordinates.
        </p>
      )}

      <label className="block text-xs font-semibold">
        Workload
        <select
          className={field}
          value={workload}
          onChange={(e) => onWorkload(e.target.value as Workload)}
        >
          <option value="light">Light</option>
          <option value="moderate">Moderate</option>
          <option value="heavy">Heavy</option>
        </select>
      </label>

      <label className="block text-xs font-semibold">
        Who is this for?
        <select
          className={field}
          value={profile}
          onChange={(e) => onProfile(e.target.value as SensitivityProfile)}
        >
          {SENSITIVITY_PROFILES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="touch-target flex items-center gap-3 text-xs font-semibold leading-snug">
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={acclimatized}
          onChange={(e) => onAcclimatized(e.target.checked)}
        />
        Acclimatized (1–2+ weeks on the job)
      </label>

      <label className="block text-xs font-semibold">
        UV skin type (Fitzpatrick)
        <select
          className={field}
          value={skinType}
          onChange={(e) => onSkinType(Number(e.target.value))}
        >
          {skinLabels.map((roman, i) => (
            <option key={roman} value={i + 1}>
              Type {roman}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[0.65rem] font-normal text-[var(--muted)]">
          Minutes-to-burn uses this type. Default III.
        </span>
      </label>
    </nav>
  )
}
