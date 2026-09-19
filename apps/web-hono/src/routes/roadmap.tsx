import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { PublicShell } from "@/components/landing/public-shell";
import { RoadmapTimeline } from "@/components/roadmap/roadmap-timeline";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/roadmap")({
  staticData: { shell: "marketing" },
  head: ({ match }) =>
    pageHead({ locale: match.context.locale, page: "roadmap", path: "/roadmap" }),
  component: RoadmapPage,
});

function RoadmapPage() {
  const t = useTranslations("roadmap");
  return (
    <PublicShell>
      {/* A plain div, not <main>: the root document already wraps the Outlet in one. */}
      <div className="mx-auto max-w-3xl px-6 py-14">
        <header className="mb-14">
          <p className="text-sm font-semibold uppercase tracking-wider text-[var(--kaipu-accent-primary)]">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">{t("heading")}</h1>
          <p className="mt-4 text-[var(--kaipu-text-secondary)]">{t("intro")}</p>
          <p className="mt-3 text-sm text-[var(--kaipu-text-muted)]">{t("disclaimer")}</p>
        </header>
        <RoadmapTimeline />
      </div>
    </PublicShell>
  );
}
