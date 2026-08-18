import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { usePrefersReducedMotion } from '../design/usePrefersReducedMotion'
import type { AssessResponse } from '../types'
import { VerdictBand } from './ConditionsChart'

const DRIVERS: Array<{ id: string; label: string; color: string; dash: string }> = [
  { id: 'heat', label: 'Heat', color: '#E69F00', dash: '0' },
  { id: 'smoke', label: 'Smoke', color: '#D55E00', dash: '6 4' },
  { id: 'air_quality', label: 'Air quality', color: '#CC79A7', dash: '2 4' },
  { id: 'uv', label: 'UV', color: '#0072B2', dash: '8 4 2 4' },
  { id: 'wind', label: 'Wind', color: '#56B4E9', dash: '1 6' },
]

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

export function LoadContributionChart({
  hours,
  textMode,
  onSelectHour,
}: {
  hours: Row[]
  textMode: boolean
  onSelectHour?: (day: string | null, hour: number) => void
}) {
  const reduced = usePrefersReducedMotion()
  const data = useMemo(
    () =>
      hours.map((h) => {
        const stack = h.driver_stack ?? {}
        const fired = (h.interactions ?? []).length > 0
        return {
          label: tickLabel(h),
          hour: h.hour,
          day: h.day ?? null,
          load: h.load_score ?? 0,
          fired,
          heat: stack.heat ?? 0,
          smoke: stack.smoke ?? 0,
          air_quality: stack.air_quality ?? 0,
          uv: stack.uv ?? 0,
          wind: stack.wind ?? 0,
        }
      }),
    [hours],
  )

  if (textMode) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="mb-2 text-left text-sm font-bold">Load contribution by hour</caption>
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-1 pr-2">Hour</th>
              <th className="py-1 pr-2">Heat</th>
              <th className="py-1 pr-2">Smoke</th>
              <th className="py-1 pr-2">Air</th>
              <th className="py-1 pr-2">UV</th>
              <th className="py-1 pr-2">Wind</th>
              <th className="py-1 pr-2">Load</th>
              <th className="py-1">Interactions</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => {
              const s = h.driver_stack ?? {}
              const sum = Object.values(s).reduce((a, b) => a + b, 0)
              return (
                <tr key={`${h.day}-${h.hour}`} className="border-b border-[var(--border)]">
                  <td className="py-1 pr-2 tabular-nums">{tickLabel(h)}</td>
                  <td className="py-1 pr-2 tabular-nums">{(s.heat ?? 0).toFixed(1)}</td>
                  <td className="py-1 pr-2 tabular-nums">{(s.smoke ?? 0).toFixed(1)}</td>
                  <td className="py-1 pr-2 tabular-nums">{(s.air_quality ?? 0).toFixed(1)}</td>
                  <td className="py-1 pr-2 tabular-nums">{(s.uv ?? 0).toFixed(1)}</td>
                  <td className="py-1 pr-2 tabular-nums">{(s.wind ?? 0).toFixed(1)}</td>
                  <td className="py-1 pr-2 tabular-nums">{(h.load_score ?? sum).toFixed(1)}</td>
                  <td className="py-1">{(h.interactions ?? []).join(', ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <div className="h-56 w-full" role="img" aria-label="Stacked driver contributions to load score">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
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
                const row = payload[0]?.payload
                return (
                  <div className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs">
                    <p className="font-bold">{label}</p>
                    {payload.map((p) => (
                      <p key={String(p.dataKey)} style={{ color: p.color }}>
                        {p.name}: {Number(p.value).toFixed(1)}
                      </p>
                    ))}
                    <p className="mt-1 font-semibold">Load {Number(row?.load ?? 0).toFixed(1)}</p>
                    {row?.fired ? <p>Interaction rule fired this hour</p> : null}
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {DRIVERS.map((d) => (
              <Area
                key={d.id}
                type="monotone"
                dataKey={d.id}
                name={d.label}
                stackId="load"
                stroke={d.color}
                fill={d.color}
                fillOpacity={0.55}
                strokeDasharray={d.dash === '0' ? undefined : d.dash}
                isAnimationActive={!reduced}
              />
            ))}
            <Line
              type="linear"
              dataKey={(row: { fired?: boolean }) => (row.fired ? 100 : null)}
              name="Interaction fired"
              stroke="#000000"
              strokeWidth={0}
              dot={{ r: 3, stroke: '#000000', fill: '#FFFFFF', strokeWidth: 1.5 }}
              legendType="circle"
              isAnimationActive={false}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <VerdictBand hours={hours} />
      <p className="mt-1 text-[0.65rem] text-[var(--muted)]">
        Stack height equals load score. Hours with an interaction rule are noted in the tooltip.
      </p>
    </div>
  )
}
