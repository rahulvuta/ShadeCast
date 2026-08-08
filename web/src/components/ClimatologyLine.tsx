export function ClimatologyLine({ message, note }: { message: string; note: string }) {
  return (
    <section aria-labelledby="clim-heading" className="dash-panel flex h-full flex-col p-3.5 sm:p-4">
      <p className="dash-section-label">Climatology & trends</p>
      <h2 id="clim-heading" className="text-sm font-bold mt-0.5">
        Today vs NASA POWER
      </h2>
      <p className="mt-3 text-base font-semibold leading-snug flex-1">{message}</p>
      <p className="mt-3 text-[0.7rem] text-[var(--muted)] leading-relaxed">{note}</p>
    </section>
  )
}
