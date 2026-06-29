import { Apple } from "lucide-react";
import { downloadUrls } from "@/lib/download";

/** Per-arch macOS download CTAs + a disabled Windows placeholder. */
export function DownloadButtons() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <a
        href={downloadUrls.macArm64}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400"
      >
        <Apple className="h-5 w-5" /> Descargar para Mac (Apple Silicon)
      </a>
      <a
        href={downloadUrls.macX64}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-3 font-semibold text-zinc-100 transition hover:border-zinc-500"
      >
        <Apple className="h-5 w-5" /> Mac (Intel)
      </a>
      <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-5 py-3 font-semibold text-zinc-500">
        Windows (próximamente)
      </span>
    </div>
  );
}
