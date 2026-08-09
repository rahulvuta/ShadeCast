import type { AssessResponse, FirePoint, Verdict } from '../types'

export const INTEGRITY_TAB_ID = 'integrity'

export type IntegrityTabState = {
  label: string
  lat: number
  lon: number
  eventId: string | null
  loading: boolean
  error: string | null
  assess: AssessResponse | null
}

export type LocationTab = {
  id: string
  label: string
  lat: number
  lon: number
  eventId: string | null
  assess: AssessResponse
  fires: FirePoint[]
  firesError: string | null
  selectedDay: string | null
}

export function shortTabLabel(label: string): string {
  const base = label.split(' (')[0]?.trim() || label
  return base.length > 28 ? `${base.slice(0, 26)}…` : base
}

export function sameLocationTab(
  a: { lat: number; lon: number; eventId: string | null },
  b: { lat: number; lon: number; eventId: string | null },
): boolean {
  if (a.eventId || b.eventId) return a.eventId === b.eventId && Boolean(a.eventId)
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01
}

export function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function tabVerdict(assess: AssessResponse): Verdict | null {
  if (assess.data_confidence?.level === 'UNUSABLE') return null
  return assess.current.verdict
}

export function isUnusable(assess: AssessResponse): boolean {
  return assess.data_confidence?.level === 'UNUSABLE'
}
