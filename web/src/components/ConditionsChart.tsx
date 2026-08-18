import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { verdictPalette } from '../design/tokens'
import {
  HAZARD_META,
  aqiHazard,
  heatIndexHazard,
  smokeHazard,
  thresholdHazard,
  uvHazard,
  windHazard,
  type HazardKey,
} from '../lib/hazardScales'
import type { AssessResponse, Verdict } from '../types'
import { usePrefersReducedMotion } from '../design/usePrefersReducedMotion'

const KEYS: HazardKey[] = ['heat', 'uv', 'aqi', 'smoke', 'wind']

type Row = AssessResponse['hourly'][number]

function tickLabel(h: Row): string {
  const hh = String(h.hour).padStart(2, '0')
  if (h.day) return `${h.day.slice(5)} ${hh}`
  return hh
}

function hourFromChartClick(state: unknown): { day: string | null; hour: number } | null {
  if (!state || typeof state !== 'object') return null
  const payload = (state as { activePayload?: Array<{ payload?: { day?: string | null; hour?: number } }> })
    .activePayload?.[0]?.payload
  if (!payload || typeof payload.hour !== 'number') return null
  return { day: payload.day ?? null, hour: payload.hour }
}

export function ConditionsChart({
  hours,
  textMode,
  onSelectHour,
}: {
  hours: Row[]
  textMode: boolean
  onSelectHour?: (day: string | null, hour: number) => void
}) {
  const reduced = usePrefersReducedMotion()
  const [enabled, setEnabled] = useState<Record<HazardKey, boolean>>({
    heat: true,
    uv: true,
    aqi: true,
    smoke: true,
    wind: true,
  })

  const data = useMemo(
    () =>
      hours.map((h) => ({
        label: tickLabel(h),
        hour: h.hour,
        day: h.day ?? null,
        verdict: h.verdict as Verdict,
        heat: heatIndexHazard(h.heat_index_f),
        heatRaw: h.heat_index_f,
        uv: uvHazard(h.uv_index),
        uvRaw: h.uv_index,
        aqi: aqiHazard(h.us_aqi),
        aqiRaw: h.us_aqi,
        smoke: smokeHazard(h.smoke_pressure),
        smokeRaw: h.smoke_pressure,
        wind: windHazard(h.wind_gusts_kmh),
        windRaw: h.wind_gusts_kmh,
      })),
    [hours],
  )

  if (textMode) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="mb-2 text-left text-sm font-bold">Conditions by hour</caption>
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-1 pr-2">Hour</th>
              <th className="py-1 pr-2">Heat index °F</th>
              <th className="py-1 pr-2">UV</th>
              <th className="py-1 pr-2">US AQI</th>
              <th className="py-1 pr-2">Smoke</th>
              <th className="py-1 pr-2">Gusts km/h</th>
              <th className="py-1">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={`${h.day}-${h.hour}`} className="border-b border-[var(--border)]">
                <td className="py-1 pr-2 tabular-nums">{tickLabel(h)}</td>
                <td className="py-1 pr-2 tabular-nums">{h.heat_index_f ?? '—'}</td>
                <td className="py-1 pr-2 tabular-nums">{h.uv_index ?? '—'}</td>
                <td className="py-1 pr-2 tabular-nums">{h.us_aqi ?? '—'}</td>
                <td className="py-1 pr-2 tabular-nums">{h.smoke_pressure.toFixed(0)}</td>
                <td className="py-1 pr-2 tabular-nums">{h.wind_gusts_kmh ?? '—'}</td>
                <td className="py-1">{h.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={enabled[key]}
            onClick={() => setEnabled((s) => ({ ...s, [key]: !s[key] }))}
            className={`touch-target rounded border px-2 text-[0.65rem] font-bold ${
              enabled[key] ? 'border-[var(--ink)]' : 'border-[var(--border)] opacity-50'
            }`}
            style={{ color: HAZARD_META[key].color }}
          >
            {HAZARD_META[key].label}
          </button>
        ))}
      </div>
      <div className="h-56 w-full" role="img" aria-label="Normalized 0 to 100 hazard lines by hour">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
            onClick={(state) => {
              const p = hourFromChartClick(state)
              if (p && onSelectHour) onSelectHour(p.day, p.hour)
            }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs">
                    <p className="font-bold">{label}</p>
                    {payload.map((p) => {
                      const key = p.dataKey as HazardKey
                      const meta = HAZARD_META[key]
                      if (!meta) return null
                      const raw = p.payload[`${key}Raw`]
                      return (
                        <p key={key} style={{ color: meta.color }}>
                          {meta.label}: {raw ?? '—'} {meta.unit} ({Number(p.value).toFixed(0)}/100)
                        </p>
                      )
                    })}
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {KEYS.map((key) =>
              enabled[key] ? (
                <ReferenceLine
                  key={`${key}-thr`}
                  y={thresholdHazard(key)}
                  stroke={HAZARD_META[key].color}
                  strokeDasharray="2 6"
                  strokeOpacity={0.45}
                />
              ) : null,
            )}
            {KEYS.map((key) =>
              enabled[key] ? (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={HAZARD_META[key].label}
                  stroke={HAZARD_META[key].color}
                  strokeDasharray={HAZARD_META[key].dash === '0' ? undefined : HAZARD_META[key].dash}
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={!reduced}
                />
              ) : null,
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <VerdictBand hours={hours} />
    </div>
  )
}

export function VerdictBand({ hours }: { hours: Row[] }) {
  return (
    <div className="mt-1 flex h-2 w-full overflow-hidden rounded" aria-hidden>
      {hours.map((h) => (
        <span
          key={`${h.day}-${h.hour}`}
          className="h-full flex-1"
          style={{ background: verdictPalette[h.verdict as Verdict]?.base ?? '#5A6570' }}
          title={`${tickLabel(h)} ${h.verdict}`}
        />
      ))}
    </div>
  )
}
