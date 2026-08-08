import type { FormEvent } from 'react'
import {
  CORRUPT_DEMO,
  DEMO_LOCATIONS,
  SENSITIVITY_PROFILES,
  type Lang,
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
  lang,
  profile,
  acclimatized,
  onSearchQuery,
  onLatInput,
  onLonInput,
  onWorkload,
  onLang,
  onProfile,
  onAcclimatized,
  onApplyLocation,
  onRunSearch,
  onGoLatLon,
}: {
  loc: ActiveLocation
  corruptDemo: boolean
  searchQuery: string
  searchHits: GeocodeHit[]
  searchBusy: boolean
  searchError: string | null
  latInput: string
  lonInput: string
  workload: Workload
  lang: Lang
  profile: SensitivityProfile
  acclimatized: boolean
  onSearchQuery: (v: string) => void
  onLatInput: (v: string) => void
  onLonInput: (v: string) => void
  onWorkload: (v: Workload) => void
  onLang: (v: Lang) => void
  onProfile: (v: SensitivityProfile) => void
  onAcclimatized: (v: boolean) => void
  onApplyLocation: (next: ActiveLocation) => void
  onRunSearch: (e?: FormEvent) => void
  onGoLatLon: (e?: FormEvent) => void
}) {
  const field =
    'touch-target mt-1 w-full rounded border border-[var(--border)] bg-white px-2.5 text-sm'

  return (
    <nav aria-label="Location and settings" className="space-y-3">
      <div>
        <p className="dash-section-label mb-1.5">Quick demos</p>
        <div className="flex flex-wrap gap-1.5">
          {[...DEMO_LOCATIONS, ...(corruptDemo ? [CORRUPT_DEMO] : [])].map((d) => {
            const active = Math.abs(loc.lat - d.lat) < 0.01 && Math.abs(loc.lon - d.lon) < 0.01
            return (
              <button
                key={d.key}
                type="button"
                className={`touch-target rounded border px-2.5 py-1.5 text-xs font-semibold ${
                  active
                    ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                    : 'border-[var(--border)] bg-white hover:border-[var(--ink)]'
                }`}
                onClick={() => onApplyLocation({ lat: d.lat, lon: d.lon, label: d.label })}
              >
                {d.label.split(' (')[0]}
              </button>
            )
          })}
        </div>
      </div>

      <form onSubmit={(e) => void onRunSearch(e)} className="space-y-1.5">
        <label className="block text-xs font-semibold" htmlFor="place-search">
          Search / coordinates
        </label>
        <div className="flex gap-1.5">
          <input
            id="place-search"
            className={`${field} min-w-0 flex-1 !mt-0`}
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            placeholder="City or town"
            autoComplete="off"
          />
          <button
            type="submit"
            className="touch-target shrink-0 rounded bg-[var(--ink)] px-3 text-xs font-semibold text-white disabled:opacity-50"
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

      <p className="text-[0.7rem] text-[var(--muted)] leading-snug">
        Active: <strong className="text-[var(--ink)]">{loc.label}</strong>
        <br />
        {loc.lat.toFixed(3)}, {loc.lon.toFixed(3)}
      </p>

      <div className="grid grid-cols-2 gap-2">
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
          Language
          <select
            className={field}
            value={lang}
            onChange={(e) => onLang(e.target.value as Lang)}
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="vi">Vietnamese</option>
          </select>
        </label>
      </div>

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

      <label className="flex items-start gap-2 text-xs font-semibold leading-snug">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={acclimatized}
          onChange={(e) => onAcclimatized(e.target.checked)}
        />
        Acclimatized (1–2+ weeks on the job)
      </label>
    </nav>
  )
}
