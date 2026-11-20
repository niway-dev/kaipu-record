import { ArrowRight, FlaskConical, Minus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { ROADMAP_ITEMS, stateOf } from "@/components/roadmap/roadmap-config";
import { ON_THE_WAY_TILES } from "./on-the-way-tiles";
import { PixelGrid } from "./pixel-grid";
import { useReveal } from "./use-reveal";
import styles from "./on-the-way.module.css";

/**
 * Tools that exist but are not in the download: five tiles, each badged with its row's
 * macOS state from the roadmap (Private beta or Planned), so nothing here reads as
 * available. The footer line says it in words and links to the full roadmap.
 */
export function OnTheWay() {
  const t = useTranslations("landing");
  const r = useTranslations("roadmap");
  const { ref, shown } = useReveal<HTMLUListElement>();

  return (
    <section id="on-the-way" className={`${styles.section} kl-dots`}>
      <PixelGrid className={styles.pixels} />

      <div className={styles.inner}>
        <p className={styles.eyebrow}>{t("homeOnTheWayEyebrow")}</p>
        <h2 className={styles.title}>{t("homeOnTheWayTitle")}</h2>
        <p className={styles.serif}>{t("homeOnTheWaySerif")}</p>
        <p className={styles.body}>{t("homeOnTheWayBody")}</p>

        <ul ref={ref} className={`${styles.tiles} kl-reveal`} data-kl-shown={shown}>
          {ON_THE_WAY_TILES.map((tile) => {
            const item = ROADMAP_ITEMS.find((row) => row.id === tile.roadmapId)!;
            const state = stateOf(item, "mac");
            const Icon = tile.icon;
            const Badge = state === "beta" ? FlaskConical : Minus;
            return (
              <li key={tile.id} className={styles.tile} data-state={state}>
                <span className={styles.icon} aria-hidden>
                  <Icon size={20} />
                </span>
                <h3 className={styles.tileTitle}>{t(tile.title)}</h3>
                <p className={styles.tileBody}>{t(tile.body)}</p>
                <span className={styles.badge} data-state={state}>
                  <Badge size={12} strokeWidth={2.5} aria-hidden />
                  {r(`status.${state}`)}
                </span>
              </li>
            );
          })}
        </ul>

        <Link to="/roadmap" className={styles.cta}>
          {t("homeOnTheWayCta")}
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
