import { Monitor, Shield, SlidersHorizontal, Keyboard } from "lucide-react";

const FEATURES = [
  {
    icon: Monitor,
    title: "Pantalla + cámara",
    body: "Grabá tu pantalla con una burbuja de cámara flotante, lista para tutoriales y demos.",
  },
  {
    icon: Shield,
    title: "Local-first y privado",
    body: "Todo se procesa y guarda en tu equipo. Nada sale a la nube sin que vos quieras.",
  },
  {
    icon: SlidersHorizontal,
    title: "Calidad configurable",
    body: "Elegí resolución, fluidez y peso con presets claros — de liviano a máxima calidad.",
  },
  {
    icon: Keyboard,
    title: "Atajos globales",
    body: "Iniciá, detené y traé la app al frente desde cualquier lado con atajos rebindeables.",
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid gap-6 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-xl border border-[var(--kaipu-border)] bg-[var(--kaipu-bg-card)] p-6"
          >
            <Icon className="h-6 w-6 text-[var(--kaipu-accent)]" />
            <h3 className="mt-4 font-semibold text-[var(--kaipu-text-primary)]">{title}</h3>
            <p className="mt-2 text-sm text-[var(--kaipu-text-secondary)]">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
