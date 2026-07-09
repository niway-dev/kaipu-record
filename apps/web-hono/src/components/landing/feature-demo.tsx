import type { LucideIcon } from "lucide-react";
import { type Messages, useTranslations } from "@kaipu/i18n";
import { DemoVideo } from "./demo-video";

/** A message key within the `landing` namespace (keeps `t()` strongly typed). */
type LandingKey = keyof Messages["landing"] & string;

interface FeatureDemoProps {
  icon: LucideIcon;
  titleKey: LandingKey;
  bodyKey: LandingKey;
  /** Demo clip base filename (see DemoVideo). */
  demo: string;
  /** Put the demo on the left and the copy on the right (alternating rows). */
  reverse?: boolean;
}

/** One showcase row: copy on one side, a looping demo on the other. */
export function FeatureDemo({ icon: Icon, titleKey, bodyKey, demo, reverse }: FeatureDemoProps) {
  const t = useTranslations("landing");
  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div className={reverse ? "md:order-2" : undefined}>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--kaipu-border)] bg-[var(--kaipu-bg-card)] text-[var(--kaipu-accent-primary)]">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="mt-5 text-2xl font-bold tracking-tight text-[var(--kaipu-text-primary)]">
          {t(titleKey)}
        </h3>
        <p className="mt-3 text-lg text-[var(--kaipu-text-secondary)]">{t(bodyKey)}</p>
      </div>
      <DemoVideo name={demo} className={`shadow-2xl ${reverse ? "md:order-1" : ""}`} />
    </div>
  );
}
