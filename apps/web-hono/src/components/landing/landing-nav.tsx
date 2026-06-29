export function LandingNav() {
  return (
    <nav className="flex items-center justify-between px-6 py-4">
      <span className="flex items-center gap-2 font-bold text-zinc-100">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Kaipu
      </span>
      <a
        href="#download"
        className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
      >
        Descargar
      </a>
    </nav>
  );
}
