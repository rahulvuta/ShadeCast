import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchAirGrid, type AirGridCell } from '../api'
import { zoomToFitRadius } from '../lib/mercator'
import { TileMosaic } from './TileMosaic'
import { AirQualityOverlay, cellScore } from './AirQualityOverlay'

/** Dashed ring / disc the CAMS field fills (~110 km). */
const CAMS_VIEW_RADIUS_KM = 110

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function boxSize(el: HTMLElement): { width: number; height: number } {
  const r = el.getBoundingClientRect()
  return { width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) }
}

type WindOverlay = {
  updateWind: (from: number, speed: number | null) => void
  resize: (width: number, height: number) => void
  destroy: () => void
}

/** Slow wind streamlines as a plain canvas overlay. */
function attachWindOverlay(
  container: HTMLElement,
  windFromDeg: number,
  windSpeedKmh: number | null,
  width: number,
  height: number,
): WindOverlay {
  let windFrom = windFromDeg
  let speed = windSpeedKmh ?? 12
  let canvas: HTMLCanvasElement | null = document.createElement('canvas')
  let raf = 0
  let lastTs = 0
  const particles: { x: number; y: number; offset: number }[] = []
  const COUNT = 36

  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '2'
  container.appendChild(canvas)

  function spawn() {
    if (!canvas) return
    particles.length = 0
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        offset: Math.random() * Math.PI * 2,
      })
    }
  }

  function resize(w: number, h: number) {
    if (!canvas) return
    canvas.width = Math.max(1, Math.round(w))
    canvas.height = Math.max(1, Math.round(h))
    spawn()
  }

  function frame(ts: number) {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const dt = lastTs ? Math.min(32, ts - lastTs) / 16.67 : 1
    lastTs = ts

    ctx.clearRect(0, 0, w, h)

    const toward = ((windFrom + 180) % 360) * (Math.PI / 180)
    const drift = 0.06 + Math.min(0.22, (speed / 40) * 0.22)
    const dx = Math.sin(toward) * drift * dt
    const dy = -Math.cos(toward) * drift * dt
    const streakLen = 36 + Math.min(44, speed * 1.1)
    const perpX = Math.cos(toward)
    const perpY = Math.sin(toward)

    for (const p of particles) {
      p.x += dx
      p.y += dy
      p.offset += 0.02 * dt

      if (p.x < -streakLen || p.x > w + streakLen || p.y < -streakLen || p.y > h + streakLen) {
        p.x = Math.random() * w
        p.y = Math.random() * h
      }

      const wobble = Math.sin(p.offset) * 2.5
      const tailX = p.x - Math.sin(toward) * streakLen + perpX * wobble
      const tailY = p.y + Math.cos(toward) * streakLen + perpY * wobble
      const headX = p.x + Math.sin(toward) * 10 + perpX * wobble * 0.5
      const headY = p.y - Math.cos(toward) * 10 + perpY * wobble * 0.5

      const grad = ctx.createLinearGradient(tailX, tailY, headX, headY)
      grad.addColorStop(0, 'rgba(120, 170, 210, 0)')
      grad.addColorStop(0.45, 'rgba(140, 190, 230, 0.18)')
      grad.addColorStop(1, 'rgba(200, 225, 245, 0.42)')

      ctx.strokeStyle = grad
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(headX, headY)
      ctx.stroke()
    }
    raf = requestAnimationFrame(frame)
  }

  resize(width, height)
  raf = requestAnimationFrame(frame)

  return {
    updateWind(from, spd) {
      windFrom = from
      speed = spd ?? 12
    },
    resize,
    destroy() {
      cancelAnimationFrame(raf)
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas)
      canvas = null
    },
  }
}

function summaryLine(cells: AirGridCell[], smokePressure: number): string {
  const scores = cells.map(cellScore).filter((v): v is number => v != null)
  if (scores.length === 0) {
    return `CAMS field ${smokePressure.toFixed(0)}/100 at the crew point. Modelled particulates, not satellite fire dots.`
  }
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const atCrew = smokePressure.toFixed(0)
  if (Math.abs(max - min) < 8) {
    return `CAMS US AQI about ${Math.round((min + max) / 2)} across this view · smoke ${atCrew}/100 at the crew point.`
  }
  return `CAMS US AQI ${Math.round(min)}–${Math.round(max)} in this view · smoke ${atCrew}/100 at the crew point.`
}

export function FireMap({
  lat,
  lon,
  windFromDeg,
  windSpeedKmh = null,
  smokePressure = 0,
  textMode,
  defaultOpen = true,
  historicalStart = null,
  historicalEnd = null,
}: {
  lat: number
  lon: number
  windFromDeg: number | null
  windSpeedKmh?: number | null
  smokePressure?: number
  textMode: boolean
  defaultOpen?: boolean
  historicalStart?: string | null
  historicalEnd?: string | null
}) {
  const [open, setOpen] = useState(defaultOpen)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const windHostRef = useRef<HTMLDivElement | null>(null)
  const windOverlayRef = useRef<WindOverlay | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoomOffset, setZoomOffset] = useState(0)
  const [cells, setCells] = useState<AirGridCell[]>([])
  const [gridError, setGridError] = useState<string | null>(null)
  const [gridLoading, setGridLoading] = useState(false)
  const [gridReload, setGridReload] = useState(0)

  const wind = windFromDeg ?? 0
  const legend = summaryLine(cells, smokePressure)

  const baseZoom =
    size.width > 0 && size.height > 0
      ? zoomToFitRadius(lat, CAMS_VIEW_RADIUS_KM, size.width, size.height, 48)
      : 6
  const zoom = Math.max(1, Math.min(12, baseZoom + zoomOffset))

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    let raf1 = 0
    let raf2 = 0

    const apply = () => {
      if (cancelled) return
      const next = boxSize(el)
      if (next.width <= 0 || next.height <= 0) return
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      )
    }

    apply()
    raf1 = requestAnimationFrame(() => {
      apply()
      raf2 = requestAnimationFrame(apply)
    })
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    window.addEventListener('resize', apply)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      ro.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [open, textMode])

  useEffect(() => {
    setZoomOffset(0)
  }, [lat, lon])

  useEffect(() => {
    let cancelled = false
    setGridLoading(true)
    setGridError(null)
    void fetchAirGrid(lat, lon, {
      startDate: historicalStart ?? undefined,
      endDate: historicalEnd ?? undefined,
    })
      .then((res) => {
        if (!cancelled) {
          setCells(res.cells ?? [])
          setGridError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCells([])
          setGridError(err instanceof Error ? err.message : 'Could not load CAMS field')
        }
      })
      .finally(() => {
        if (!cancelled) setGridLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lat, lon, historicalStart, historicalEnd, gridReload])

  useEffect(() => {
    if (!open || textMode || prefersReducedMotion()) {
      windOverlayRef.current?.destroy()
      windOverlayRef.current = null
      return
    }
    const host = windHostRef.current
    if (!host || size.width <= 0 || size.height <= 0) return

    if (!windOverlayRef.current) {
      try {
        windOverlayRef.current = attachWindOverlay(host, wind, windSpeedKmh, size.width, size.height)
      } catch (err) {
        console.error('[FireMap] wind overlay failed', err)
      }
    } else {
      windOverlayRef.current.resize(size.width, size.height)
      windOverlayRef.current.updateWind(wind, windSpeedKmh)
    }
  }, [open, textMode, size.width, size.height, wind, windSpeedKmh])

  useEffect(() => {
    return () => {
      windOverlayRef.current?.destroy()
      windOverlayRef.current = null
    }
  }, [])

  const windLabel =
    windFromDeg == null
      ? 'Wind n/a'
      : `Wind from ${Math.round(windFromDeg)}° (meteorological). ${windSpeedKmh != null ? `${Math.round(windSpeedKmh)} km/h` : 'speed n/a'}`
  const ready = size.width > 0 && size.height > 0
  const scored = cells
    .map((c) => ({ c, score: cellScore(c) }))
    .filter((row) => row.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  return (
    <section aria-labelledby="map-heading" className="flex h-full min-h-[inherit] flex-col p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="dash-section-label">Air quality map</p>
          <h2 id="map-heading" className="text-sm font-bold mt-0.5">
            CAMS particulate field
          </h2>
        </div>
        <button
          type="button"
          className="touch-target shrink-0 rounded border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--ink)]"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)] mt-1">{legend}</p>
      {gridError && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--restrict)]">
          <span>CAMS field failed to load. {gridError}</span>
          <button
            type="button"
            className="touch-target rounded border border-[var(--border)] px-2 py-1 font-semibold text-[var(--ink)]"
            onClick={() => setGridReload((n) => n + 1)}
          >
            Reload field
          </button>
        </div>
      )}
      {gridLoading && !gridError && (
        <p className="mt-1 text-xs text-[var(--muted)]">Loading CAMS field…</p>
      )}
      <p className="type-micro text-[var(--muted)] mt-1 normal-case tracking-normal font-normal">
        Dashed ring = CAMS field extent ({CAMS_VIEW_RADIUS_KM} km). Shaded disc = regional Open-Meteo
        CAMS PM2.5 / US AQI (~45 km model, ~24 h lag). Not sample-site markers. {windLabel}
      </p>

      {open && !textMode && (
        <div className="relative mt-2">
          <div
            ref={containerRef}
            className="relative min-h-[22rem] lg:min-h-[28rem] w-full overflow-hidden rounded border border-[var(--border)]"
            style={{ height: '28rem' }}
          >
            {!ready && (
              <div
                className="absolute inset-0 animate-pulse bg-[var(--panel)]"
                aria-hidden
              />
            )}
            {ready && (
              <>
                <TileMosaic
                  centerLat={lat}
                  centerLon={lon}
                  zoom={zoom}
                  width={size.width}
                  height={size.height}
                />
                <AirQualityOverlay
                  lat={lat}
                  lon={lon}
                  zoom={zoom}
                  width={size.width}
                  height={size.height}
                  cells={cells}
                  radiusKm={CAMS_VIEW_RADIUS_KM}
                />
                <div ref={windHostRef} className="pointer-events-none absolute inset-0 z-[2]" />
              </>
            )}
          </div>

          <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--card)]/95 shadow-sm">
            <button
              type="button"
              className="touch-target px-3 py-1.5 text-sm font-bold hover:bg-[var(--panel)]"
              aria-label="Zoom in"
              disabled={zoom >= 12}
              onClick={() => setZoomOffset((o) => Math.min(12 - baseZoom, o + 1))}
            >
              +
            </button>
            <button
              type="button"
              className="touch-target border-t border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--panel)]"
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoomOffset((o) => Math.max(1 - baseZoom, o - 1))}
            >
              −
            </button>
          </div>

          {windFromDeg != null && (
            <div
              className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-3 rounded-lg border-2 border-[var(--ink)] bg-[var(--card)]/95 px-3 py-2.5 shadow-md backdrop-blur-sm"
              aria-hidden
            >
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-[var(--panel)]"
                style={{ transform: `rotate(${windFromDeg}deg)` }}
              >
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
                  <path
                    d="M18 4 L28 26 L18 21 L8 26 Z"
                    fill="var(--ink)"
                    stroke="var(--bg)"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="type-micro text-[var(--muted)]">Wind from (meteorological)</p>
                <p className="text-xl font-bold leading-tight text-[var(--ink)]">
                  {Math.round(windFromDeg)}°
                </p>
                <p className="text-xs font-semibold text-[var(--muted)]">
                  {windSpeedKmh != null ? `${Math.round(windSpeedKmh)} km/h` : 'speed n/a'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {open && textMode && (
        <ul className="mt-2 max-h-64 overflow-auto text-xs space-y-1">
          {scored.length === 0 ? (
            <li>No CAMS cells loaded.</li>
          ) : (
            scored.slice(0, 25).map(({ c, score }) => (
              <li key={`${c.latitude}-${c.longitude}`}>
                {c.latitude.toFixed(3)}, {c.longitude.toFixed(3)} · US AQI {score != null ? Math.round(score) : '—'}
                {c.pm2_5 != null ? ` · PM2.5 ${c.pm2_5.toFixed(1)}` : ''}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  )
}
