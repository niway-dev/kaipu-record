import { DownloadButtons } from "./download-buttons";

export function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-6 pt-16 pb-12 text-center md:pt-24">
      <h1 className="text-4xl font-bold tracking-tight text-zinc-50 md:text-6xl">
        Grabá tu pantalla,
        <span className="mt-2 block text-emerald-400">sin complicaciones.</span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
        Kaipu Record graba tu pantalla y tu cámara en alta calidad, directo en tu equipo. Privado,
        rápido y sin cuentas.
      </p>
      <div className="mt-10">
        <DownloadButtons />
      </div>
      <div className="mx-auto mt-14 aspect-video max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900/60" />
    </section>
  );
}
