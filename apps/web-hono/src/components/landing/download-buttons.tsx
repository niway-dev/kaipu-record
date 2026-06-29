import { Apple } from "lucide-react";
import { downloadUrls } from "@/lib/download";

/** Per-arch macOS download CTAs + a disabled Windows placeholder. */
export function DownloadButtons() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <a
        href={downloadUrls.macArm64}
        className="inline-flex items-center gap-2 rounded-lg bg-[var(--kaipu-accent)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--kaipu-accent-hover)]"
      >
        <Apple className="h-5 w-5" /> Descargar para Mac (Apple Silicon)
      </a>
      <a
        href={downloadUrls.macX64}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--kaipu-border-light)] px-5 py-3 font-semibold text-[var(--kaipu-text-primary)] transition hover:border-[var(--kaipu-text-muted)]"
      >
        <Apple className="h-5 w-5" /> Mac (Intel)
      </a>
      <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--kaipu-border)] px-5 py-3 font-semibold text-[var(--kaipu-text-muted)]">
        Windows (próximamente)
      </span>
    </div>
  );
}
