import { useEffect, useMemo, useRef, useState } from 'react'
import { tilesForViewport } from '../lib/mercator'

const OSM_TILE = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`

const TILE_FAIL_MS = 4000

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

  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set())
  const [tilesFailed, setTilesFailed] = useState(false)
  const loadedRef = useRef(0)

  useEffect(() => {
    loadedRef.current = 0
    setFailedKeys(new Set())
    setTilesFailed(false)
    const t = window.setTimeout(() => {
      if (loadedRef.current === 0) setTilesFailed(true)
    }, TILE_FAIL_MS)
    return () => window.clearTimeout(t)
  }, [tiles])

  return (
    <>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width, height, background: 'var(--panel, #e8eaed)' }}
        aria-hidden
      >
        {tilesFailed
          ? null
          : tiles.map((tile) => {
              const key = `${tile.z}/${tile.x}/${tile.y}`
              if (failedKeys.has(key)) {
                return (
                  <div
                    key={key}
                    className="absolute"
                    style={{
                      left: tile.left,
                      top: tile.top,
                      width: 256,
                      height: 256,
                      background: 'var(--panel, #e8eaed)',
                    }}
                  />
                )
              }
              return (
                <img
                  key={key}
                  src={OSM_TILE(tile.z, tile.x, tile.y)}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  loading="eager"
                  decoding="async"
                  width={256}
                  height={256}
                  className="absolute select-none"
                  style={{ left: tile.left, top: tile.top, width: 256, height: 256 }}
                  onLoad={() => {
                    loadedRef.current += 1
                  }}
                  onError={() => {
                    setFailedKeys((prev) => {
                      const next = new Set(prev)
                      next.add(key)
                      return next
                    })
                  }}
                />
              )
            })}
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
