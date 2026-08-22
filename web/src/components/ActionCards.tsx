import type { ActionItem } from '../types'
import { kitGlyphFor, triggerFamily, TRIGGER_CHIP } from '../lib/kitIcons'
import { KitIcon } from './KitIcon'
import { WhySource } from './WhySource'

export function ActionCards({ actions }: { actions: ActionItem[] }) {
  const items = actions.filter((a) => a.category !== 'clothing')
  if (!items.length) return null
  return (
    <section aria-labelledby="actions-heading" className="dash-panel h-full p-3.5">
      <h2 id="actions-heading" className="dash-section-label">
        Recommended actions
      </h2>
      <ul className="mt-2 space-y-2">
        {items.map((a) => {
          const family = triggerFamily(a.trigger)
          const chip = TRIGGER_CHIP[family]
          return (
            <li
              key={a.id}
              className="flex overflow-hidden rounded border border-[var(--border)] bg-[var(--panel)]"
            >
              <span className={`w-1 shrink-0 ${chip.rail}`} aria-hidden />
              <div className="min-w-0 flex-1 px-3 py-2">
                <div className="flex items-start gap-2">
                  <KitIcon glyph={kitGlyphFor(a.id)} className="mt-0.5 inline-flex shrink-0 text-[var(--ink)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold leading-snug">{a.title}</p>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide ${chip.chip}`}
                      >
                        {chip.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{a.body}</p>
                    <WhySource body={a.body} sourceUrl={a.source_url} sourceName={a.source_name} />
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
