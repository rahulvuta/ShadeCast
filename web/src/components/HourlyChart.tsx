import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AssessResponse, Verdict } from '../types'

const SEVERITY: Record<Verdict, number> = {
  GO: 1,
  CAUTION: 2,
  RESTRICT: 3,
  STOP: 4,
}

export function HourlyChart({ hourly }: { hourly: AssessResponse['hourly'] }) {
  const data = hourly.map((h) => ({
    hour: `${String(h.hour).padStart(2, '0')}`,
    severity: SEVERITY[h.verdict],
    verdict: h.verdict,
    hi: h.heat_index_f ?? null,
  }))

  return (
    <section aria-labelledby="chart-heading" className="rounded-2xl bg-[var(--card)] border border-[var(--border)] p-4 shadow-sm">
      <h2 id="chart-heading" className="text-lg font-bold">
        Risk severity by hour
      </h2>
      <p className="text-xs text-[var(--muted)] mb-2">1=GO · 2=CAUTION · 3=RESTRICT · 4=STOP</p>
      <div className="h-40 w-full" role="img" aria-label="Bar chart of hourly risk severity">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
            <YAxis domain={[0, 4]} ticks={[1, 2, 3, 4]} tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(value, _name, props) => [
                `${props.payload.verdict} (severity ${value})`,
                'Verdict',
              ]}
            />
            <Bar dataKey="severity" fill="#0072B2" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
