export function LandingNav() {
  return (
    <nav className="flex items-center justify-between px-6 py-4">
      <span className="flex items-center gap-2 font-bold text-[var(--kaipu-text-primary)]">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--kaipu-accent)]" /> Kaipu
      </span>
      <a
        href="#download"
        className="rounded-lg bg-[var(--kaipu-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaipu-accent-hover)]"
      >
        Descargar
      </a>
    </nav>
  );
}
