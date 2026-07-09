import { useTranslations } from "@kaipu/i18n";
import { DownloadButtons } from "./download-buttons";
import { DemoVideo } from "./demo-video";

export function Hero() {
  const t = useTranslations("landing");
  return (
    <section className="mx-auto max-w-4xl px-6 pt-16 pb-12 text-center md:pt-24">
      <h1 className="text-4xl font-bold tracking-tight text-[var(--kaipu-text-primary)] md:text-6xl">
        {t("heroTitleLine1")}
        <span className="mt-2 block text-[var(--kaipu-accent-primary)]">{t("heroTitleLine2")}</span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--kaipu-text-secondary)]">
        {t("heroSubtitle")}
      </p>
      <div className="mt-10">
        <DownloadButtons />
      </div>
      <div className="mx-auto mt-14 max-w-3xl">
        <DemoVideo name="hero" className="shadow-2xl" />
      </div>
    </section>
  );
}
