export function WhySource({ body, sourceUrl, sourceName }: { body: string; sourceUrl: string; sourceName: string }) {
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-semibold text-[var(--muted)]">Why / source</summary>
      <p className="mt-1 leading-relaxed text-[var(--muted)]">{body}</p>
      <p className="mt-1 text-[0.65rem] text-[var(--muted)]">
        Source:{' '}
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline">
          {sourceName}
        </a>
      </p>
    </details>
  )
}
