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
    <section aria-labelledby="incident-heading" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 id="incident-heading" className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
        Local incident log
      </h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Stored only on this device. No accounts.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="flex-1 text-sm">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 touch-target"
            placeholder="Optional note"
          />
        </label>
        <button type="button" onClick={addEntry} className="touch-target rounded-lg bg-[var(--fg)] px-4 py-2 text-sm font-semibold text-[var(--bg)]">
          Log now
        </button>
        <button type="button" onClick={clearAll} className="touch-target rounded-lg border border-[var(--border)] px-4 py-2 text-sm">
          Clear
        </button>
      </div>
      {entries.length > 0 && (
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
          {entries.map((e) => (
            <li key={e.id} className="rounded border border-[var(--border)] px-3 py-2">
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
