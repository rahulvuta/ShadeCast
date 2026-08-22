import type { AssessResponse, Verdict } from '../types'

export type ClockHour = { hour: number; verdict: Verdict | null }

/** One sector per clock hour. Missing hours stay null (no-data), never GO. */
export function clockHoursForDay(
  hourly: AssessResponse['hourly'],
  selectedDay?: string | null,
): ClockHour[] {
  const day =
    selectedDay ??
    hourly.find((h) => h.is_current)?.day ??
    hourly[0]?.day ??
    null
  const rows = day ? hourly.filter((h) => !h.day || h.day === day) : hourly
  const byHour = new Map<number, Verdict>()
  for (const h of rows) {
    if (!byHour.has(h.hour)) byHour.set(h.hour, h.verdict)
  }
  const out: ClockHour[] = []
  for (let hour = 0; hour < 24; hour++) {
    out.push({ hour, verdict: byHour.get(hour) ?? null })
  }
  return out
}
