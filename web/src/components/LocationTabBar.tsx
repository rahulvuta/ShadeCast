import {
  INTEGRITY_TAB_ID,
  shortTabLabel,
  tabVerdict,
  type IntegrityTabState,
  type LocationTab,
} from '../tabs/types'

export function LocationTabBar({
  integrity,
  tabs,
  activeTabId,
  onSelect,
  onClose,
}: {
  integrity: IntegrityTabState
  tabs: LocationTab[]
  activeTabId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  const allIds = [INTEGRITY_TAB_ID, ...tabs.map((t) => t.id)]

  return (
    <div
      className="dash-panel overflow-x-auto"
      role="tablist"
      aria-label="Location tabs"
      onKeyDown={(e) => {
        const idx = allIds.indexOf(activeTabId)
        if (idx < 0) return
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          const next = allIds[(idx + 1) % allIds.length]
          if (next) onSelect(next)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          const prev = allIds[(idx - 1 + allIds.length) % allIds.length]
          if (prev) onSelect(prev)
        }
      }}
    >
      <div className="flex min-h-11 items-stretch gap-0.5 px-1.5 py-1">
        <div
          className={`flex max-w-[14rem] items-center gap-1 rounded-t border px-2 py-1.5 ${
            activeTabId === INTEGRITY_TAB_ID
              ? 'border-[var(--border)] border-b-transparent bg-[var(--card)] accent-border'
              : 'border-transparent bg-transparent hover:bg-[var(--panel)]'
          }`}
        >
          <button
            type="button"
            role="tab"
            id={`tab-${INTEGRITY_TAB_ID}`}
            aria-selected={activeTabId === INTEGRITY_TAB_ID}
            aria-controls="main"
            tabIndex={activeTabId === INTEGRITY_TAB_ID ? 0 : -1}
            className="touch-target min-w-0 flex-1 truncate text-left text-xs font-semibold"
            title="Integrity checks"
            onClick={() => onSelect(INTEGRITY_TAB_ID)}
          >
            <span className="block truncate">Integrity</span>
            <span className="type-micro normal-case tracking-normal font-normal text-[var(--muted)]">
              {integrity.loading
                ? `Checking ${shortTabLabel(integrity.label || 'location')}…`
                : integrity.assess
                  ? integrity.assess.data_confidence?.level ?? 'Ready'
                  : 'Awaiting location'}
            </span>
          </button>
        </div>

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
      </div>
    </div>
  )
}
