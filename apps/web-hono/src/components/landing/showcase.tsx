import { Camera, Scissors, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { FeatureDemo } from "./feature-demo";

const ROWS = [
  { icon: Video, titleKey: "showRecordTitle", bodyKey: "showRecordBody", demo: "record" },
  { icon: Camera, titleKey: "showShotTitle", bodyKey: "showShotBody", demo: "screenshot" },
  { icon: Scissors, titleKey: "showEditTitle", bodyKey: "showEditBody", demo: "editor" },
] as const;

/** The heart of the landing: each core feature shown in motion. */
export function Showcase() {
  const t = useTranslations("landing");
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <h2 className="mb-16 text-center text-3xl font-bold tracking-tight text-[var(--kaipu-text-primary)] md:text-4xl">
        {t("showcaseHeading")}
      </h2>
      <div className="flex flex-col gap-20 md:gap-28">
        {ROWS.map((row, index) => (
          <FeatureDemo key={row.demo} {...row} reverse={index % 2 === 1} />
        ))}
      </div>
    </section>
  );
}
