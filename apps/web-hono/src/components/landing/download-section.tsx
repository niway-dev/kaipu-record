import { useTranslations } from "@kaipu/i18n";
import { DownloadButtons } from "./download-buttons";

export function DownloadSection() {
  const t = useTranslations("landing");
  return (
    <section id="download" className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h2 className="text-3xl font-bold text-[var(--kaipu-text-primary)]">{t("downloadTitle")}</h2>
      <p className="mt-3 text-[var(--kaipu-text-secondary)]">{t("downloadSubtitle")}</p>
      <div className="mt-8">
        <DownloadButtons />
      </div>
    </section>
  );
}
