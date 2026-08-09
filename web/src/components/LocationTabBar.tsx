import type { LocationTab } from '../tabs/types'
import { shortTabLabel, tabVerdict } from '../tabs/types'

export function LocationTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  openingLabel,
}: {
  tabs: LocationTab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  openingLabel?: string | null
}) {
  if (tabs.length === 0 && !openingLabel) return null

  return (
    <div
      className="dash-panel overflow-x-auto"
      role="tablist"
      aria-label="Location tabs"
      onKeyDown={(e) => {
        if (tabs.length === 0) return
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          const next = tabs[(idx + 1) % tabs.length]
          if (next) onSelect(next.id)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          const prev = tabs[(idx - 1 + tabs.length) % tabs.length]
          if (prev) onSelect(prev.id)
        }
      }}
    >
      <div className="flex min-h-11 items-stretch gap-0.5 px-1.5 py-1">
        {tabs.map((t) => {
          const active = t.id === activeTabId
          const v = tabVerdict(t.assess)
          return (
            <div
              key={t.id}
              className={`group flex max-w-[14rem] items-center gap-1 rounded-t border px-2 py-1.5 ${
                active
                  ? 'border-[var(--border)] border-b-transparent bg-[var(--card)] accent-border'
                  : 'border-transparent bg-transparent hover:bg-[var(--panel)]'
              }`}
            >
              <button
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={active}
                aria-controls="main"
                tabIndex={active ? 0 : -1}
                className="touch-target min-w-0 flex-1 truncate text-left text-xs font-semibold"
                title={t.label}
                onClick={() => onSelect(t.id)}
              >
                <span className="block truncate">{shortTabLabel(t.label)}</span>
                {v && (
                  <span className="type-micro normal-case tracking-normal font-normal text-[var(--muted)]">
                    {v}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm text-[var(--muted)] hover:bg-[var(--chip-bg)] hover:text-[var(--ink)]"
                aria-label={`Close ${shortTabLabel(t.label)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
        {openingLabel && (
          <div
            className="flex max-w-[14rem] items-center gap-2 rounded border border-dashed border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]"
            role="status"
          >
            Opening {shortTabLabel(openingLabel)}…
          </div>
        )}
      </div>
    </div>
  )
}
