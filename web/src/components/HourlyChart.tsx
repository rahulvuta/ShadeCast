import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { verdictPalette } from '../design/tokens'
import type { AssessResponse, Verdict } from '../types'

const SEVERITY: Record<Verdict, number> = {
  GO: 1,
  CAUTION: 2,
  RESTRICT: 3,
  STOP: 4,
}

const VERDICT_BAR_COLOR: Record<Verdict, string> = {
  GO: verdictPalette.GO.base,
  CAUTION: verdictPalette.CAUTION.base,
  RESTRICT: verdictPalette.RESTRICT.base,
  STOP: verdictPalette.STOP.base,
}

export function HourlyChart({
  hourly,
  embedded = false,
}: {
  hourly: AssessResponse['hourly']
  embedded?: boolean
}) {
  const data = hourly.map((h) => ({
    hour: `${String(h.hour).padStart(2, '0')}`,
    severity: SEVERITY[h.verdict],
    verdict: h.verdict,
    hi: h.heat_index_f ?? null,
  }))

  const body = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 id="chart-heading" className={embedded ? 'dash-section-label !normal-case tracking-wide' : 'text-lg font-bold'}>
          {embedded ? '24-hour risk severity' : 'Risk severity by hour'}
        </h2>
        <p className="text-[0.65rem] text-[var(--muted)]">1=GO · 2=CAUTION · 3=RESTRICT · 4=STOP</p>
      </div>
      <div className="h-44 w-full" role="img" aria-label="Bar chart of hourly risk severity">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
            <YAxis domain={[0, 4]} ticks={[1, 2, 3, 4]} tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(value, _name, props) => [
                `${props.payload.verdict} (severity ${value})`,
                'Verdict',
              ]}
            />
            <Bar
              dataKey="severity"
              radius={[2, 2, 0, 0]}
              isAnimationActive
              animationDuration={700}
              animationEasing="ease-out"
            >
              {data.map((entry) => (
                <Cell key={entry.hour} fill={VERDICT_BAR_COLOR[entry.verdict]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )

  if (embedded) return <div>{body}</div>

  return (
    <section aria-labelledby="chart-heading" className="dash-panel motion-panel-enter p-4">
      {body}
    </section>
  )
}
