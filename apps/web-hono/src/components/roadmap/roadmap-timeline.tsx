import { Check, CircleDashed, Loader } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import {
  ROADMAP_STATUSES,
  roadmapItemsByStatus,
  type RoadmapItemId,
  type RoadmapStatus,
} from "./roadmap-config";

/**
 * Each status carries its own icon and colour so the timeline never leans on
 * colour alone — the icon and the group heading say the same thing.
 */
const STATUS_STYLE: Record<
  RoadmapStatus,
  { icon: typeof Check; dot: string; ring: string; pill: string }
> = {
  shipped: {
    icon: Check,
    dot: "bg-[var(--kaipu-accent-green)] text-[var(--kaipu-bg-app)]",
    ring: "ring-[var(--kaipu-accent-green)]",
    pill: "border-[var(--kaipu-accent-green)] text-[var(--kaipu-accent-green)]",
  },
  inProgress: {
    icon: Loader,
    dot: "bg-[var(--kaipu-accent-yellow)] text-[var(--kaipu-bg-app)]",
    ring: "ring-[var(--kaipu-accent-yellow)]",
    pill: "border-[var(--kaipu-accent-yellow)] text-[var(--kaipu-accent-yellow)]",
  },
  planned: {
    icon: CircleDashed,
    dot: "bg-[var(--kaipu-bg-card)] text-[var(--kaipu-text-muted)]",
    ring: "ring-[var(--kaipu-border-light)]",
    pill: "border-[var(--kaipu-border-light)] text-[var(--kaipu-text-muted)]",
  },
};

/** The whole roadmap: one section per status, empty statuses omitted. */
export function RoadmapTimeline() {
  const t = useTranslations("roadmap");
  return (
    <div className="flex flex-col gap-14">
      {ROADMAP_STATUSES.map((status) => {
        const items = roadmapItemsByStatus(status);
        if (items.length === 0) return null;
        return (
          <section key={status} aria-labelledby={`roadmap-${status}`}>
            <div className="mb-6 flex items-baseline gap-3">
              <h2
                id={`roadmap-${status}`}
                className="text-xl font-bold tracking-tight text-[var(--kaipu-text-primary)]"
              >
                {t(`status.${status}`)}
              </h2>
              <span className="text-sm text-[var(--kaipu-text-muted)]">
                {t("count", { count: items.length })}
              </span>
            </div>
            <ol className="relative flex flex-col gap-4 border-l border-[var(--kaipu-border)] pl-6 sm:pl-8">
              {items.map((item) => (
                <RoadmapEntry key={item.id} id={item.id} status={status} />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function RoadmapEntry({ id, status }: { id: RoadmapItemId; status: RoadmapStatus }) {
  const t = useTranslations("roadmap");
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <li className="relative">
      {/* Sits on the rail: half the dot's width back over the 1px border. */}
      <span
        aria-hidden="true"
        className={`absolute -left-[2.05rem] top-5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-[var(--kaipu-bg-app)] sm:-left-[2.55rem] ${style.dot} ${style.ring}`}
      >
        <Icon className="h-3 w-3" strokeWidth={3} />
      </span>
      <article className="rounded-xl border border-[var(--kaipu-border)] bg-[var(--kaipu-bg-card)] p-5 transition hover:border-[var(--kaipu-border-light)] hover:bg-[var(--kaipu-bg-card-hover)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="font-semibold text-[var(--kaipu-text-primary)]">
            {t(`items.${id}.title`)}
          </h3>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.pill}`}>
            {t(`status.${status}`)}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[var(--kaipu-text-secondary)]">
          {t(`items.${id}.description`)}
        </p>
      </article>
    </li>
  );
}
