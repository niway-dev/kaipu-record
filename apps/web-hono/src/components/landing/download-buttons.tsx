import { Apple } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { downloadUrls } from "@/lib/download";

/** Per-arch macOS download CTAs + a disabled Windows placeholder. */
export function DownloadButtons() {
  const t = useTranslations("landing");
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <a
        href={downloadUrls.macArm64}
        className="inline-flex items-center gap-2 rounded-lg bg-[var(--kaipu-accent-primary)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--kaipu-accent-primary-hover)]"
      >
        <Apple className="h-5 w-5" /> {t("downloadMacArm")}
      </a>
      <a
        href={downloadUrls.macX64}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--kaipu-border-light)] px-5 py-3 font-semibold text-[var(--kaipu-text-primary)] transition hover:border-[var(--kaipu-text-muted)]"
      >
        <Apple className="h-5 w-5" /> {t("downloadMacIntel")}
      </a>
      <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--kaipu-border)] px-5 py-3 font-semibold text-[var(--kaipu-text-muted)]">
        {t("downloadWindows")}
      </span>
    </div>
  );
}
