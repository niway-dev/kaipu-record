import { Keyboard, Library, Shield, SlidersHorizontal, UserX } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

const CARDS = [
  { icon: Library, titleKey: "featureGalleryTitle", bodyKey: "featureGalleryBody" },
  { icon: Shield, titleKey: "featurePrivateTitle", bodyKey: "featurePrivateBody" },
  { icon: UserX, titleKey: "featureNoAccountTitle", bodyKey: "featureNoAccountBody" },
  { icon: SlidersHorizontal, titleKey: "featureQualityTitle", bodyKey: "featureQualityBody" },
  { icon: Keyboard, titleKey: "featureShortcutsTitle", bodyKey: "featureShortcutsBody" },
] as const;

/** Secondary value props — the reasons to choose Kaipu, as compact cards. */
export function WhyKaipu() {
  const t = useTranslations("landing");
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="mb-10 text-center text-3xl font-bold tracking-tight text-[var(--kaipu-text-primary)]">
        {t("whyHeading")}
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(({ icon: Icon, titleKey, bodyKey }) => (
          <div
            key={titleKey}
            className="rounded-xl border border-[var(--kaipu-border)] bg-[var(--kaipu-bg-card)] p-6 transition hover:border-[var(--kaipu-border-light)] hover:bg-[var(--kaipu-bg-card-hover)]"
          >
            <Icon className="h-6 w-6 text-[var(--kaipu-accent-primary)]" />
            <h3 className="mt-4 font-semibold text-[var(--kaipu-text-primary)]">{t(titleKey)}</h3>
            <p className="mt-2 text-sm text-[var(--kaipu-text-secondary)]">{t(bodyKey)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
