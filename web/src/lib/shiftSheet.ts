import type { AssessResponse, HourlyAssessment, SensitivityProfile, Workload } from '../types'
import type { SelectedShift } from './shiftWindow'
import { hoursInShift, shiftBounds, shiftSummary } from './shiftWindow'

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
  selected?: SelectedShift | null
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

export type ShiftSheetHourRow = {
  time: string
  day: string
  weather: string
  heat: string
  humidityBand: string
  uv: string
  air: string
  wind: string
  rating: string
  workMinutes: number
  restMinutes: number
  precaution: string | null
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
  chosenHeader: string | null
  chosenWorst: string | null
  chosenSafeMinutes: number | null
  stormLines: string[]
  hourRows: ShiftSheetHourRow[]
  days: ShiftSheetDayRow[]
  windows: ShiftSheetWindowRow[]
  windowsEmpty: string | null
  otherWindowsLine: string | null
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

function heatLabel(h: HourlyAssessment): string {
  if (h.heat_index_f != null) return `${Math.round(h.heat_index_f)} F HI`
  if (h.temperature_c != null) return `${Math.round((h.temperature_c * 9) / 5 + 32)} F`
  return '—'
}

function windLabel(h: HourlyAssessment): string {
  const spd = h.wind_speed_kmh != null ? `${Math.round(h.wind_speed_kmh)} km/h` : '—'
  if (h.wind_gusts_kmh != null) return `${spd} g${Math.round(h.wind_gusts_kmh)}`
  return spd
}

function hourRow(h: HourlyAssessment): ShiftSheetHourRow {
  return {
    time: fmtHour(h.hour),
    day: h.day ?? '—',
    weather: h.weather_text ?? '—',
    heat: heatLabel(h),
    humidityBand: h.humidity_band ?? '—',
    uv: h.uv_index != null ? String(Math.round(h.uv_index)) : '—',
    air: h.us_aqi != null ? `AQI ${Math.round(h.us_aqi)}` : '—',
    wind: windLabel(h),
    rating: h.verdict,
    workMinutes: h.work_minutes,
    restMinutes: h.rest_minutes,
    precaution: h.precaution ?? null,
  }
}

export function buildShiftSheet(input: ShiftSheetInput): ShiftSheetContent {
  const { assess, locationLabel, workload, profile, shareUrl, selected } = input
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

  const pool = assess.horizon?.length ? assess.horizon : assess.hourly
  const shiftHours = hoursInShift(pool ?? [], selected ?? null)
  const hourRows = shiftHours.map(hourRow)
  const summary = shiftHours.length ? shiftSummary(shiftHours) : null

  let chosenHeader: string | null = null
  let chosenWorst: string | null = null
  let chosenSafeMinutes: number | null = null
  if (selected) {
    if (summary) {
      chosenHeader = `${summary.startLabel} – ${summary.endLabel}`
      chosenWorst = summary.worst
      chosenSafeMinutes = summary.safeMinutes
    } else {
      const b = shiftBounds(selected)
      const endLabel = fmtHour(b.endHour)
      chosenHeader = `${b.day} ${fmtHour(b.startHour)}–${endLabel}`
      chosenWorst = null
      chosenSafeMinutes = 0
    }
  }

  const stormLines: string[] = []
  const storm = assess.storm
  if (storm?.headline_quote || storm?.headline_event) {
    const src = storm.source === 'open-meteo' ? 'Open-Meteo' : storm.source === 'nws' ? 'NWS' : ''
    const event = storm.headline_event ?? storm.headline_quote
    const quote = storm.headline_quote && storm.headline_quote !== event ? ` — ${storm.headline_quote}` : ''
    stormLines.push(`${src ? `${src}: ` : ''}${event}${quote}`.trim())
  }
  if (storm?.watch_note) stormLines.push(storm.watch_note)
  const seenPrecaution = new Set<string>()
  for (const h of shiftHours) {
    if (h.precaution && !seenPrecaution.has(h.precaution)) {
      seenPrecaution.add(h.precaution)
      stormLines.push(h.precaution)
    }
  }

  const otherWindowsLine =
    selected && windows.length > 0
      ? windows
          .filter((w) => {
            const b = shiftBounds(selected)
            return !(w.day === b.day && w.block === `${fmtHour(b.startHour)}–${fmtHour(b.endHour)}`)
          })
          .map((w) => `${w.day} ${w.block} (${w.daypart})`)
          .join(' · ') || null
      : null

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
    chosenHeader,
    chosenWorst,
    chosenSafeMinutes,
    stormLines,
    hourRows,
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
    otherWindowsLine,
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
  ]

  if (sheet.chosenHeader) {
    lines.push(
      '',
      'Chosen shift',
      sheet.chosenHeader,
      `Worst hour: ${sheet.chosenWorst ?? '—'} · Safe outdoor minutes: ${sheet.chosenSafeMinutes ?? 0}`,
    )
  }

  if (sheet.stormLines.length > 0) {
    lines.push('', 'Storm / precautions')
    for (const s of sheet.stormLines) lines.push(`• ${s}`)
  }

  if (sheet.hourRows.length > 0) {
    lines.push('', 'Hour forecast')
    lines.push('Time | Weather | Heat | RH | UV | Air | Wind | Rating | Work min')
    for (const h of sheet.hourRows) {
      const prec = h.precaution ? ` · ${h.precaution}` : ''
      lines.push(
        `${h.time} | ${h.weather} | ${h.heat} | ${h.humidityBand} | ${h.uv} | ${h.air} | ${h.wind} | ${h.rating} | ${h.workMinutes}/${h.restMinutes}${prec}`,
      )
    }
  }

  lines.push('', '5-day overview')

  if (sheet.days.length === 0) {
    lines.push('No day summaries available.')
  } else {
    lines.push('Day | Safe h | Worst | Hard-stop | Best work')
    for (const d of sheet.days) {
      lines.push(`${d.day} | ${d.safeHours} | ${d.worst} | ${d.hardStop} | ${d.bestWork}`)
    }
  }

  lines.push('', sheet.otherWindowsLine ? 'Other dayparts' : 'Ranked shift windows')
  if (sheet.windowsEmpty) {
    lines.push(sheet.windowsEmpty)
  } else if (sheet.otherWindowsLine) {
    lines.push(sheet.otherWindowsLine)
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
