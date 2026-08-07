import type { ActionItem } from '../types'

export function ActionCards({ actions }: { actions: ActionItem[] }) {
  if (!actions.length) return null
  return (
    <section aria-labelledby="actions-heading" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 id="actions-heading" className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
        Recommended actions
      </h2>
      <ul className="mt-3 space-y-3">
        {actions.map((a) => (
          <li key={a.id} className="rounded-lg border border-[var(--border)] p-3">
            <p className="font-semibold">{a.title}</p>
            <p className="mt-1 text-sm leading-relaxed">{a.body}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
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
