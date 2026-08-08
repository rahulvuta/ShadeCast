import { useEffect, useState } from 'react'
import type { IncidentLogEntry } from '../types'

const KEY = 'shadecast_incident_log_v1'

function loadEntries(): IncidentLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as IncidentLogEntry[]
  } catch {
    return []
  }
}

function saveEntries(entries: IncidentLogEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 50)))
}

export function IncidentLog({
  lat,
  lon,
  label,
  verdict,
}: {
  lat: number
  lon: number
  label: string
  verdict: string | null
}) {
  const [entries, setEntries] = useState<IncidentLogEntry[]>([])
  const [note, setNote] = useState('')

  useEffect(() => {
    setEntries(loadEntries())
  }, [])

  function addEntry() {
    const entry: IncidentLogEntry = {
      id: `${Date.now()}`,
      at: new Date().toISOString(),
      lat,
      lon,
      label,
      note: note.trim() || 'Logged condition check',
      verdict,
    }
    const next = [entry, ...entries]
    setEntries(next)
    saveEntries(next)
    setNote('')
  }

  function clearAll() {
    setEntries([])
    saveEntries([])
  }

  return (
    <section aria-labelledby="incident-heading">
      <h2 id="incident-heading" className="dash-section-label">
        Local incident log
      </h2>
      <p className="mt-1 text-[0.65rem] text-[var(--muted)]">Stored on this device only.</p>
      <div className="mt-2 space-y-1.5">
        <label className="block text-xs font-semibold">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2.5 py-2 text-sm touch-target"
            placeholder="Optional note"
          />
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={addEntry}
            className="touch-target flex-1 rounded bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white"
          >
            Log now
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="touch-target rounded border border-[var(--border)] px-3 py-1.5 text-xs"
          >
            Clear
          </button>
        </div>
      </div>
      {entries.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs">
          {entries.map((e) => (
            <li key={e.id} className="rounded border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5">
              <p className="font-semibold">
                {new Date(e.at).toLocaleString()} · {e.verdict ?? 'n/a'}
              </p>
              <p className="text-[var(--muted)]">
                {e.label} ({e.lat.toFixed(2)}, {e.lon.toFixed(2)})
              </p>
              <p>{e.note}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
