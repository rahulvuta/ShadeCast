export function ClimatologyLine({ message, note }: { message: string; note: string }) {
  return (
    <section aria-labelledby="clim-heading" className="rounded-2xl bg-[var(--card)] border border-[var(--border)] p-4 shadow-sm">
      <h2 id="clim-heading" className="text-lg font-bold">
        Versus climatology
      </h2>
      <p className="mt-2 text-lg font-semibold">{message}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">{note}</p>
    </section>
  )
}
