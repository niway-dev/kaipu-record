import { Monitor, Shield, SlidersHorizontal, Keyboard } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

const FEATURE_ICONS = [
  { icon: Monitor, titleKey: "featureScreenTitle", bodyKey: "featureScreenBody" },
  { icon: Shield, titleKey: "featurePrivateTitle", bodyKey: "featurePrivateBody" },
  { icon: SlidersHorizontal, titleKey: "featureQualityTitle", bodyKey: "featureQualityBody" },
  { icon: Keyboard, titleKey: "featureShortcutsTitle", bodyKey: "featureShortcutsBody" },
] as const;

export function Features() {
  const t = useTranslations("landing");
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid gap-6 sm:grid-cols-2">
        {FEATURE_ICONS.map(({ icon: Icon, titleKey, bodyKey }) => (
          <div
            key={titleKey}
            className="rounded-xl border border-[var(--kaipu-border)] bg-[var(--kaipu-bg-card)] p-6"
          >
            <Icon className="h-6 w-6 text-[var(--kaipu-accent)]" />
            <h3 className="mt-4 font-semibold text-[var(--kaipu-text-primary)]">{t(titleKey)}</h3>
            <p className="mt-2 text-sm text-[var(--kaipu-text-secondary)]">{t(bodyKey)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
