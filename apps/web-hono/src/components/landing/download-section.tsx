import { DownloadButtons } from "./download-buttons";

export function DownloadSection() {
  return (
    <section id="download" className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h2 className="text-3xl font-bold text-[var(--kaipu-text-primary)]">Descargá Kaipu Record</h2>
      <p className="mt-3 text-[var(--kaipu-text-secondary)]">
        Gratis para macOS 11+. Windows próximamente.
      </p>
      <div className="mt-8">
        <DownloadButtons />
      </div>
    </section>
  );
}
