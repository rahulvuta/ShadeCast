import { metersPerPixel, projectToViewport } from '../lib/mercator'

export type AirGridCell = {
  latitude: number
  longitude: number
  pm2_5: number | null
  us_aqi: number | null
  dust: number | null
  pm10_wildfires: number | null
}

const CELL_KM = 45

function cellFill(cell: AirGridCell): { fill: string; opacity: number } {
  const aqi = cell.us_aqi
  const pm = cell.pm2_5
  const score = aqi ?? (pm != null ? pm * 4 : 0)
  if (score <= 50) return { fill: '#009E73', opacity: 0.22 }
  if (score <= 100) return { fill: '#F0E442', opacity: 0.28 }
  if (score <= 150) return { fill: '#E69F00', opacity: 0.32 }
  return { fill: '#D55E00', opacity: 0.38 }
}

export function AirQualityOverlay({
  lat,
  lon,
  zoom,
  width,
  height,
  cells,
}: {
  lat: number
  lon: number
  zoom: number
  width: number
  height: number
  cells: AirGridCell[]
}) {
  const mpp = metersPerPixel(lat, zoom)
  const half = (CELL_KM * 1000) / mpp / 2

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 z-[1]"
      aria-hidden
    >
      {cells.map((c) => {
        const { x, y } = projectToViewport(c.latitude, c.longitude, lat, lon, zoom, width, height)
        if (x < -half || y < -half || x > width + half || y > height + half) return null
        const { fill, opacity } = cellFill(c)
        return (
          <rect
            key={`${c.latitude},${c.longitude}`}
            x={x - half}
            y={y - half}
            width={half * 2}
            height={half * 2}
            fill={fill}
            fillOpacity={opacity}
            stroke={fill}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
        )
      })}
    </svg>
  )
}
