import type { ActionItem } from '../types'

export function ActionCards({ actions }: { actions: ActionItem[] }) {
  if (!actions.length) return null
  return (
    <section aria-labelledby="actions-heading" className="dash-panel p-3.5">
      <h2 id="actions-heading" className="dash-section-label">
        Recommended actions
      </h2>
      <ul className="mt-2 space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
            <p className="text-sm font-semibold">{a.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{a.body}</p>
            <p className="mt-1 text-[0.65rem] text-[var(--muted)]">
              Source:{' '}
              <a href={a.source_url} target="_blank" rel="noreferrer" className="underline">
                {a.source_name}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
