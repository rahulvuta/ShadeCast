import { useEffect, useRef } from 'react'
import {
  latLonToWorldPx,
  metersPerPixel,
  projectToViewport,
  worldPxToLatLon,
} from '../lib/mercator'

export type AirGridCell = {
  latitude: number
  longitude: number
  pm2_5: number | null
  us_aqi: number | null
  dust: number | null
  pm10_wildfires: number | null
}

type Sample = { lat: number; lon: number; v: number }

/** Weather-map AQI stops: transparent when clean, denser as particulates rise. */
const AQI_STOPS: Array<{ aqi: number; r: number; g: number; b: number; a: number }> = [
  { aqi: 0, r: 0, g: 158, b: 115, a: 0 },
  { aqi: 40, r: 0, g: 158, b: 115, a: 28 },
  { aqi: 80, r: 201, g: 176, b: 55, a: 72 },
  { aqi: 100, r: 230, g: 159, b: 0, a: 110 },
  { aqi: 150, r: 213, g: 94, b: 0, a: 145 },
  { aqi: 200, r: 204, g: 121, b: 167, a: 165 },
  { aqi: 300, r: 114, g: 40, b: 114, a: 185 },
]

const CONTOURS = [50, 100, 150, 200]
const SCALE = 3
const EARTH_RADIUS_KM = 6371
const EDGE_FADE = 0.08

export function cellScore(cell: AirGridCell): number | null {
  if (cell.us_aqi != null && Number.isFinite(cell.us_aqi)) return cell.us_aqi
  if (cell.pm2_5 != null && Number.isFinite(cell.pm2_5)) {
    const pm = cell.pm2_5
    if (pm < 12) return (pm / 12) * 50
    if (pm < 35.5) return 50 + ((pm - 12) / 23.5) * 50
    if (pm < 55.5) return 100 + ((pm - 35.5) / 20) * 50
    if (pm < 150.5) return 150 + ((pm - 55.5) / 95) * 50
    return Math.min(300, 200 + (pm - 150.5) / 2)
  }
  return null
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function insideRadiusKm(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
  radiusKm: number,
): boolean {
  return distanceKm(lat, lon, centerLat, centerLon) <= radiusKm
}

function colorForAqi(aqi: number, alphaScale = 1): [number, number, number, number] {
  const x = Math.max(0, Math.min(300, aqi))
  let lo = AQI_STOPS[0]!
  let hi = AQI_STOPS[AQI_STOPS.length - 1]!
  for (let i = 0; i < AQI_STOPS.length - 1; i++) {
    if (x >= AQI_STOPS[i]!.aqi && x <= AQI_STOPS[i + 1]!.aqi) {
      lo = AQI_STOPS[i]!
      hi = AQI_STOPS[i + 1]!
      break
    }
  }
  const span = hi.aqi - lo.aqi
  const t = span <= 0 ? 0 : (x - lo.aqi) / span
  return [
    Math.round(lo.r + (hi.r - lo.r) * t),
    Math.round(lo.g + (hi.g - lo.g) * t),
    Math.round(lo.b + (hi.b - lo.b) * t),
    Math.round((lo.a + (hi.a - lo.a) * t) * alphaScale),
  ]
}

function samplesFromCells(cells: AirGridCell[]): Sample[] {
  const out: Sample[] = []
  for (const c of cells) {
    const v = cellScore(c)
    if (v == null) continue
    out.push({ lat: c.latitude, lon: c.longitude, v })
  }
  return out
}

function interpolateIdw(
  lat: number,
  lon: number,
  samples: Sample[],
  centerLat: number,
  centerLon: number,
  radiusKm: number,
): { v: number; fade: number } | null {
  if (samples.length === 0) return null
  const dist = distanceKm(lat, lon, centerLat, centerLon)
  if (dist > radiusKm) return null

  const fadeStart = radiusKm * (1 - EDGE_FADE)
  const fade = dist > fadeStart ? Math.max(0, 1 - (dist - fadeStart) / (radiusKm - fadeStart)) : 1

  const cos = Math.cos((lat * Math.PI) / 180)
  let num = 0
  let den = 0
  for (const s of samples) {
    const dlat = lat - s.lat
    const dlon = (lon - s.lon) * cos
    const d2 = dlat * dlat + dlon * dlon
    if (d2 < 1e-12) return { v: s.v, fade }
    const w = 1 / d2
    num += w * s.v
    den += w
  }
  if (den <= 0) return null
  return { v: num / den, fade }
}

function viewportToLatLon(
  px: number,
  py: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number,
): { lat: number; lon: number } {
  const center = latLonToWorldPx(centerLat, centerLon, zoom)
  return worldPxToLatLon(center.x + (px - width / 2), center.y + (py - height / 2), zoom)
}

function edgeCross(
  ax: number,
  ay: number,
  av: number,
  bx: number,
  by: number,
  bv: number,
  level: number,
): { x: number; y: number } | null {
  const aHit = av >= level
  const bHit = bv >= level
  if (aHit === bHit || av < 0 || bv < 0) return null
  const t = (level - av) / (bv - av)
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t }
}

function radiusPx(lat: number, zoom: number, radiusKm: number): number {
  return (radiusKm * 1000) / metersPerPixel(lat, zoom)
}

function paintField(
  ctx: CanvasRenderingContext2D,
  samples: Sample[],
  lat: number,
  lon: number,
  zoom: number,
  width: number,
  height: number,
  radiusKm: number,
) {
  const w = Math.max(1, Math.ceil(width / SCALE))
  const h = Math.max(1, Math.ceil(height / SCALE))
  const img = ctx.createImageData(w, h)
  const data = img.data
  const field = new Float32Array(w * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5) * SCALE
      const py = (y + 0.5) * SCALE
      const ll = viewportToLatLon(px, py, lat, lon, zoom, width, height)
      const hit = interpolateIdw(ll.lat, ll.lon, samples, lat, lon, radiusKm)
      const idx = y * w + x
      if (!hit) {
        field[idx] = -1
        continue
      }
      field[idx] = hit.v
      const [r, g, b, a] = colorForAqi(hit.v, hit.fade)
      const o = idx * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a
    }
  }

  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const offCtx = off.getContext('2d')
  if (!offCtx) return
  offCtx.putImageData(img, 0, 0)

  const r = radiusPx(lat, zoom, radiusKm)
  const cx = width / 2
  const cy = height / 2

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(off, 0, 0, width, height)

  ctx.lineWidth = 1.15
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const level of CONTOURS) {
    const [cr, cg, cb] = colorForAqi(level)
    ctx.strokeStyle = `rgba(${Math.max(0, cr - 40)},${Math.max(0, cg - 40)},${Math.max(0, cb - 40)},0.5)`
    ctx.beginPath()
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const v00 = field[y * w + x]!
        const v10 = field[y * w + x + 1]!
        const v01 = field[(y + 1) * w + x]!
        const v11 = field[(y + 1) * w + x + 1]!
        const x0 = x * SCALE
        const y0 = y * SCALE
        const x1 = x0 + SCALE
        const y1 = y0 + SCALE
        const pts = [
          edgeCross(x0, y0, v00, x1, y0, v10, level),
          edgeCross(x1, y0, v10, x1, y1, v11, level),
          edgeCross(x0, y1, v01, x1, y1, v11, level),
          edgeCross(x0, y0, v00, x0, y1, v01, level),
        ].filter((p): p is { x: number; y: number } => p != null)
        if (pts.length < 2) continue
        ctx.moveTo(pts[0]!.x, pts[0]!.y)
        ctx.lineTo(pts[1]!.x, pts[1]!.y)
        if (pts[2]) {
          ctx.moveTo(pts[2].x, pts[2].y)
          ctx.lineTo((pts[3] ?? pts[0]!).x, (pts[3] ?? pts[0]!).y)
        }
      }
    }
    ctx.stroke()
  }
  ctx.restore()
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[4] rounded border border-[var(--border)] bg-[var(--card)]/95 px-2 py-1.5 shadow-sm">
      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
        CAMS particulates
      </p>
      <div
        className="mt-1 h-2 w-40 overflow-hidden rounded"
        style={{
          background:
            'linear-gradient(90deg, rgba(0,158,115,0.15), rgba(201,176,55,0.55), rgba(213,94,0,0.7), rgba(114,40,114,0.8))',
        }}
      />
      <div className="mt-0.5 flex justify-between text-[0.55rem] text-[var(--muted)]">
        <span>Clear</span>
        <span>Hazy</span>
        <span>Heavy</span>
      </div>
    </div>
  )
}

export function AirQualityOverlay({
  lat,
  lon,
  zoom,
  width,
  height,
  cells,
  radiusKm,
}: {
  lat: number
  lon: number
  zoom: number
  width: number
  height: number
  cells: AirGridCell[]
  radiusKm: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const crew = projectToViewport(lat, lon, lat, lon, zoom, width, height)
  const rPx = radiusPx(lat, zoom, radiusKm)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const samples = samplesFromCells(cells)
    if (samples.length === 0) {
      ctx.clearRect(0, 0, width, height)
      return
    }
    paintField(ctx, samples, lat, lon, zoom, width, height, radiusKm)
  }, [lat, lon, zoom, width, height, cells, radiusKm])

  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0">
        <circle
          cx={crew.x}
          cy={crew.y}
          r={rPx}
          fill="none"
          stroke="#666666"
          strokeWidth={2}
          strokeDasharray="8 6"
          strokeOpacity={0.7}
        />
        <circle cx={crew.x} cy={crew.y} r={10} fill="none" stroke="#0072B2" strokeWidth={3} />
        <circle cx={crew.x} cy={crew.y} r={4} fill="#0072B2" />
      </svg>
      <Legend />
    </div>
  )
}
