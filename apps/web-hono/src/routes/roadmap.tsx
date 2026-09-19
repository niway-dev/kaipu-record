import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/landing/footer";
import { RoadmapTimeline } from "@/components/roadmap/roadmap-timeline";
import { pageHead } from "@/lib/seo";
import { useLandingTheme } from "@/components/theme-toggle";

export const Route = createFileRoute("/roadmap")({
  head: () =>
    pageHead({
      title: "Roadmap | Kaipu Record",
      description:
        "Qué ya está en Kaipu Record y qué viene después: el roadmap público, agrupado por estado.",
      path: "/roadmap",
    }),
  component: RoadmapPage,
});

function RoadmapPage() {
  const theme = useLandingTheme();
  const t = useTranslations("roadmap");
  return (
    <div
      data-theme={theme === "light" ? "light" : undefined}
      className="min-h-screen bg-[var(--kaipu-bg-app)] text-[var(--kaipu-text-primary)]"
    >
      <LandingNav />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <header className="mb-14">
          <p className="text-sm font-semibold uppercase tracking-wider text-[var(--kaipu-accent-primary)]">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">{t("heading")}</h1>
          <p className="mt-4 text-[var(--kaipu-text-secondary)]">{t("intro")}</p>
          <p className="mt-3 text-sm text-[var(--kaipu-text-muted)]">{t("disclaimer")}</p>
        </header>
        <RoadmapTimeline />
      </main>
      <Footer />
    </div>
  );
}
