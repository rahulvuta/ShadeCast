import { useEffect, useMemo, useRef, useState } from 'react'
import { TILE_SIZE, tilesForViewport, type ViewportTile } from '../lib/mercator'

const OSM_TILE = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`

const MAX_ATTEMPTS = 3

function OsmTile({ tile }: { tile: ViewportTile }) {
  const [attempt, setAttempt] = useState(0)
  const [dead, setDead] = useState(false)
  const retryRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (retryRef.current != null) window.clearTimeout(retryRef.current)
    }
  }, [])

  if (dead) {
    return (
      <div
        className="absolute"
        style={{
          left: tile.left,
          top: tile.top,
          width: TILE_SIZE,
          height: TILE_SIZE,
          background: 'var(--panel, #e8eaed)',
        }}
      />
    )
  }

  return (
    <img
      key={attempt}
      src={OSM_TILE(tile.z, tile.x, tile.y)}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="eager"
      decoding="async"
      width={TILE_SIZE}
      height={TILE_SIZE}
      className="absolute select-none"
      style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
      onError={() => {
        if (attempt + 1 >= MAX_ATTEMPTS) {
          setDead(true)
          return
        }
        retryRef.current = window.setTimeout(
          () => setAttempt((n) => n + 1),
          500 * 2 ** attempt,
        )
      }}
    />
  )
}

export function TileMosaic({
  centerLat,
  centerLon,
  zoom,
  width,
  height,
}: {
  centerLat: number
  centerLon: number
  zoom: number
  width: number
  height: number
}) {
  const tiles = useMemo(
    () => tilesForViewport(centerLat, centerLon, zoom, width, height),
    [centerLat, centerLon, zoom, width, height],
  )

  return (
    <>
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{ width, height, background: 'var(--panel, #e8eaed)' }}
        aria-hidden
      >
        {tiles.map((tile) => (
          <OsmTile key={`${tile.z}/${tile.x}/${tile.y}`} tile={tile} />
        ))}
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-1 right-1 z-[2] rounded bg-[var(--card)]/90 px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink)] underline-offset-2 hover:underline"
      >
        © OpenStreetMap contributors
      </a>
    </>
  )
}
