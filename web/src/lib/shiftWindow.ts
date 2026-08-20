import type { HourlyAssessment } from '../types'

export type SelectedShift =
  | { kind: 'plan'; day: string; startHour: number; endHour: number }
  | { kind: 'custom'; day: string; startHour: number; duration: number }

export function selectedKey(sel: SelectedShift): string {
  if (sel.kind === 'plan') return `plan:${sel.day}:${sel.startHour}:${sel.endHour}`
  return `custom:${sel.day}:${sel.startHour}:${sel.duration}`
}

export function shiftBounds(sel: SelectedShift): {
  day: string
  startHour: number
  duration: number
  endHour: number
} {
  const duration =
    sel.kind === 'custom'
      ? Math.max(1, sel.duration)
      : sel.endHour > sel.startHour
        ? sel.endHour - sel.startHour
        : 24 - sel.startHour + sel.endHour
  const hours = Math.max(1, duration)
  return {
    day: sel.day,
    startHour: sel.startHour,
    duration: hours,
    endHour: (sel.startHour + hours) % 24,
  }
}

export function hoursInShift(
  horizon: HourlyAssessment[],
  sel: SelectedShift | null,
): HourlyAssessment[] {
  if (!sel || horizon.length === 0) return []
  const { day, startHour, duration } = shiftBounds(sel)
  const startIdx = horizon.findIndex((h) => h.day === day && h.hour === startHour)
  if (startIdx >= 0) {
    return horizon.slice(startIdx, startIdx + duration)
  }
  // Horizon may not be strictly sequential; walk from the matching day.
  const out: HourlyAssessment[] = []
  let collecting = false
  for (const h of horizon) {
    if (!collecting && h.day === day && h.hour === startHour) collecting = true
    if (collecting) {
      out.push(h)
      if (out.length >= duration) break
    }
  }
  return out
}

export function shiftSummary(hours: HourlyAssessment[]): {
  worst: string
  safeMinutes: number
  startLabel: string
  endLabel: string
} {
  const rank: Record<string, number> = { GO: 0, CAUTION: 1, RESTRICT: 2, STOP: 3 }
  let worst = 'GO'
  let safeMinutes = 0
  for (const h of hours) {
    if ((rank[h.verdict] ?? 0) > (rank[worst] ?? 0)) worst = h.verdict
    safeMinutes += h.work_minutes
  }
  const first = hours[0]
  const last = hours[hours.length - 1]
  const fmt = (h: HourlyAssessment | undefined) =>
    h ? `${String(h.hour).padStart(2, '0')}:00` : '—'
  return {
    worst,
    safeMinutes,
    startLabel: first ? `${first.day} ${fmt(first)}` : '—',
    endLabel: last ? `${last.day} ${fmt(last)}` : '—',
  }
}
