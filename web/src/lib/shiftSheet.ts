import type { AssessResponse, SensitivityProfile, Workload } from '../types'

export const CLOTHING_ZONE_ORDER = [
  'head',
  'eyes',
  'torso',
  'hands',
  'feet',
  'respiratory',
] as const

export const CLOTHING_ZONE_LABEL: Record<(typeof CLOTHING_ZONE_ORDER)[number], string> = {
  head: 'Head',
  eyes: 'Eyes',
  torso: 'Torso',
  hands: 'Hands',
  feet: 'Feet',
  respiratory: 'Respiratory',
}

export type ShiftSheetInput = {
  assess: AssessResponse
  locationLabel: string
  workload: Workload
  profile: SensitivityProfile
  shareUrl: string
  now?: Date
}

export type ShiftSheetDayRow = {
  day: string
  safeHours: string
  worst: string
  hardStop: string
  bestWork: string
}

export type ShiftSheetWindowRow = {
  rank: number
  day: string
  block: string
  daypart: string
  hours: string
  label: string
}

export type ShiftSheetAction = {
  title: string
  body: string
  source: string
}

export type ShiftSheetClothingZone = {
  zone: string
  label: string
  items: Array<{ title: string; source: string }>
}

export type ShiftSheetContent = {
  title: string
  subtitle: string
  locationLabel: string
  dateRange: string
  metaLine: string
  todayLine: string
  days: ShiftSheetDayRow[]
  windows: ShiftSheetWindowRow[]
  windowsEmpty: string | null
  actions: ShiftSheetAction[]
  actionsEmpty: string | null
  clothing: ShiftSheetClothingZone[]
  shareUrl: string
  sourcesLine: string
  disclaimer: string
  generatedLine: string
}

export function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

function profileLabel(profile: SensitivityProfile): string {
  return profile.replace(/_/g, ' ')
}

export function buildShiftSheet(input: ShiftSheetInput): ShiftSheetContent {
  const { assess, locationLabel, workload, profile, shareUrl } = input
  const now = input.now ?? new Date()
  const days = (assess.days ?? []).slice(0, 5)
  const dateRange =
    days.length > 0 ? `${days[0]!.day} → ${days[days.length - 1]!.day}` : 'Next 5 days'
  const verdict = assess.current.verdict ?? 'UNUSABLE'
  const load = assess.environmental_load?.load_score
  const loadPart = load != null ? ` · Load ${load.toFixed(0)}/100` : ''

  const windows = (assess.shift_windows ?? []).slice(0, 8).map((w, i) => ({
    rank: i + 1,
    day: w.day,
    block: `${fmtHour(w.start_hour)}–${fmtHour(w.end_hour)}`,
    daypart: (w.daypart ?? '—').replace(/_/g, ' '),
    hours: `${w.required_hours}h`,
    label: w.label || '',
  }))

  const actions = (assess.actions ?? [])
    .filter((a) => a.category !== 'clothing')
    .slice(0, 4)
    .map((a) => ({
      title: a.title,
      body: a.body,
      source: `${a.source_name} — ${a.source_url}`,
    }))

  const clothingItems = (assess.actions ?? []).filter((a) => a.category === 'clothing')
  const clothing: ShiftSheetClothingZone[] = []
  for (const zone of CLOTHING_ZONE_ORDER) {
    const items = clothingItems
      .filter((a) => a.body_zone === zone)
      .map((a) => ({ title: a.title, source: a.source_name }))
    if (!items.length) continue
    clothing.push({ zone, label: CLOTHING_ZONE_LABEL[zone], items })
  }

  const sourceNames = (assess.sources ?? []).map((s) => s.name).join(' · ')
  const generatedStamp = now.toISOString().slice(0, 16).replace('T', ' ')

  return {
    title: 'ShadeCast — Shift sheet',
    subtitle: 'Outdoor crew work/rest plan (decision support — not medical advice)',
    locationLabel,
    dateRange,
    metaLine: `Workload: ${workload} · Profile: ${profileLabel(profile)} · Verdict now: ${verdict}${loadPart}`,
    todayLine: `Hard-stop (today): ${assess.schedule.hard_stop_window ?? 'None'} · Best work: ${
      assess.schedule.best_work_window ?? 'n/a'
    } · Safe hours: ${assess.schedule.total_safe_hours.toFixed(1)}h`,
    days: days.map((d) => ({
      day: d.day,
      safeHours: d.total_safe_hours.toFixed(1),
      worst: d.worst_verdict,
      hardStop: d.hard_stop_window ?? 'None',
      bestWork: d.best_work_window ?? 'n/a',
    })),
    windows,
    windowsEmpty:
      windows.length === 0
        ? 'No continuous block fits without a hard stop for the selected length.'
        : null,
    actions,
    actionsEmpty: actions.length === 0 ? 'No triggered actions for current conditions.' : null,
    clothing,
    shareUrl,
    sourcesLine: sourceNames
      ? `Data sources: ${sourceNames}`
      : 'Data sources: see live assessment',
    disclaimer:
      assess.current.disclaimer ||
      'Not medical advice. Screening tool for crew scheduling only. Supervisors remain responsible for site decisions.',
    generatedLine: `Generated ${generatedStamp} UTC · ShadeCast`,
  }
}

export function formatShiftSheetText(sheet: ShiftSheetContent): string {
  const lines: string[] = [
    sheet.title,
    sheet.subtitle,
    '',
    sheet.locationLabel,
    `Date range: ${sheet.dateRange}`,
    sheet.metaLine,
    sheet.todayLine,
    '',
    '5-day overview',
  ]

  if (sheet.days.length === 0) {
    lines.push('No day summaries available.')
  } else {
    lines.push('Day | Safe h | Worst | Hard-stop | Best work')
    for (const d of sheet.days) {
      lines.push(`${d.day} | ${d.safeHours} | ${d.worst} | ${d.hardStop} | ${d.bestWork}`)
    }
  }

  lines.push('', 'Ranked shift windows')
  if (sheet.windowsEmpty) {
    lines.push(sheet.windowsEmpty)
  } else {
    lines.push('# | Day | Block | Daypart | Hours | Label')
    for (const w of sheet.windows) {
      lines.push(`${w.rank} | ${w.day} | ${w.block} | ${w.daypart} | ${w.hours} | ${w.label}`)
    }
  }

  lines.push('', 'Top action items')
  if (sheet.actionsEmpty) {
    lines.push(sheet.actionsEmpty)
  } else {
    for (const a of sheet.actions) {
      lines.push(`• ${a.title}`)
      lines.push(`  ${a.body}`)
      lines.push(`  Source: ${a.source}`)
    }
  }

  if (sheet.clothing.length > 0) {
    lines.push('', 'Clothing and PPE')
    for (const zone of sheet.clothing) {
      lines.push(zone.label)
      for (const item of zone.items) {
        lines.push(`• ${item.title} — ${item.source}`)
      }
    }
  }

  lines.push(
    '',
    'Live assessment URL:',
    sheet.shareUrl,
    '',
    sheet.sourcesLine,
    sheet.disclaimer,
    sheet.generatedLine,
  )

  return lines.join('\n')
}
