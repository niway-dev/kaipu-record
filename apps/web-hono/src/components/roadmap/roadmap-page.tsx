import { useState } from "react";
import { Apple, Check, Clock, Info, Minus, ShieldAlert, TriangleAlert } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { cssVars } from "@/components/home/css-vars";
import { PixelGrid } from "@/components/home/pixel-grid";
import { downloadUrls } from "@/lib/download";
import {
  ROADMAP_AREAS,
  ROADMAP_ITEMS,
  ROADMAP_PLATFORMS,
  ROADMAP_STATES,
  platformCounts,
  stateOf,
  type PlatformFilter,
  type RoadmapItem,
  type RoadmapPlatform,
  type RoadmapState,
} from "./roadmap-config";
import styles from "./roadmap.module.css";

/**
 * Design: Claude Design project 71546ef1, file `Kaipu Roadmap.dc.html`. The
 * layout follows it; the states do not — they come from roadmap-config.ts,
 * which is checked against the repo rather than copied from the mockup.
 *
 * Each state carries its own icon as well as its colour, so a cell never leans
 * on colour alone.
 */
const STATE_ICON: Record<RoadmapState, typeof Check> = {
  shipped: Check,
  inProgress: Clock,
  planned: Minus,
};

/** Windows wears blue on this page, as in the design; macOS wears the brand. */
const PLATFORM_TINT: Record<RoadmapPlatform, string> = {
  mac: "var(--kl-c1)",
  win: "var(--kl-c5)",
};

function StateCell({ state, label }: { state: RoadmapState; label: string }) {
  const Icon = STATE_ICON[state];
  return (
    <span className={styles.state} data-state={state}>
      <span className={styles.stateDot} aria-hidden>
        <Icon size={10} strokeWidth={3} />
      </span>
      {label}
    </span>
  );
}

function PlatformIcon({ platform, size }: { platform: RoadmapPlatform; size: number }) {
  if (platform === "mac") return <Apple size={size} aria-hidden />;
  // lucide has no Windows mark; four squares is the conventional stand-in.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  );
}

/** The opening screen: the promise, then one summary card per platform. */
export function RoadmapHero() {
  const t = useTranslations("roadmap");

  return (
    <section id="top" className={`${styles.hero} kl-dots`}>
      <div className="kl-glow kl-glow-hero" aria-hidden />
      <PixelGrid className={styles.heroPixels} />

      <div className={styles.container}>
        <p className={styles.eyebrow}>{t("page.eyebrow")}</p>
        <h1 className={styles.h1}>{t("page.heading")}</h1>
        <p className={styles.h1Serif}>{t("page.serif")}</p>
        <p className={styles.lead}>{t("page.intro")}</p>
        <p className={styles.disclaimer}>{t("page.disclaimer")}</p>

        <div className={styles.summary}>
          {ROADMAP_PLATFORMS.map((platform) => (
            <PlatformSummary key={platform} platform={platform} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformSummary({ platform }: { platform: RoadmapPlatform }) {
  const t = useTranslations("roadmap");
  const counts = platformCounts(platform);
  const total = ROADMAP_ITEMS.length;

  return (
    <article
      className={styles.summaryCard}
      data-platform={platform}
      style={cssVars({ "--rm-tint": PLATFORM_TINT[platform] })}
    >
      <div className={styles.summaryHead}>
        <span className={styles.summaryIcon}>
          <PlatformIcon platform={platform} size={20} />
        </span>
        <div className={styles.summaryText}>
          <h2 className={styles.summaryName}>{t(`platforms.${platform}.name`)}</h2>
          <p className={styles.summaryLine}>{t(`platforms.${platform}.line`)}</p>
        </div>
        <span className={styles.summaryBadge}>{t(`platforms.${platform}.badge`)}</span>
      </div>
      {/* The bar repeats the counts below it, so it is decoration for a screen reader. */}
      <div className={styles.bar} aria-hidden>
        {ROADMAP_STATES.map((state) => (
          <span
            key={state}
            className={styles.barPart}
            data-state={state}
            style={{ width: `${(counts[state] / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className={styles.summaryCounts}>
        {ROADMAP_STATES.map((state) => (
          <li key={state} className={styles.summaryCount} data-state={state}>
            <span className={styles.swatch} aria-hidden />
            {counts[state]} {t(`status.${state}`).toLowerCase()}
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * The filters and the grouped list. One component because the filter bar and
 * the groups read the same state; the server renders the default (both
 * platforms, every state) so the page is complete before it hydrates.
 */
export function RoadmapList() {
  const t = useTranslations("roadmap");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [shown, setShown] = useState<Record<RoadmapState, boolean>>({
    shipped: true,
    inProgress: true,
    planned: true,
  });

  const visible = ROADMAP_ITEMS.filter((item) => shown[stateOf(item, platform)]);
  const groups = ROADMAP_STATES.filter((state) => shown[state])
    .map((state) => ({ state, items: visible.filter((item) => stateOf(item, platform) === state) }))
    .filter((group) => group.items.length > 0);

  const hint = (state: RoadmapState) =>
    state === "shipped" && platform !== "all" ? t("groupHint.shippedOne") : t(`groupHint.${state}`);

  const platformOptions: PlatformFilter[] = ["all", ...ROADMAP_PLATFORMS];

  return (
    <>
      <div className={styles.filterBar} role="group" aria-label={t("filters.label")}>
        <div className={styles.filterInner}>
          <div className={styles.segment} role="group" aria-label={t("filters.platform")}>
            {platformOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.segmentBtn}
                aria-pressed={platform === option}
                onClick={() => setPlatform(option)}
              >
                {option !== "all" && <PlatformIcon platform={option} size={14} />}
                {option === "all" ? t("filters.both") : t(`platforms.${option}.name`)}
              </button>
            ))}
          </div>
          <span className={styles.divider} aria-hidden />
          <div className={styles.chips} role="group" aria-label={t("filters.states")}>
            {ROADMAP_STATES.map((state) => (
              <button
                key={state}
                type="button"
                className={styles.chip}
                data-state={state}
                aria-pressed={shown[state]}
                onClick={() => setShown((prev) => ({ ...prev, [state]: !prev[state] }))}
              >
                <span className={styles.swatch} aria-hidden />
                {t(`status.${state}`)}
              </button>
            ))}
          </div>
          <span className={styles.spacer} />
          <span className={styles.showing} aria-live="polite">
            {t("page.showing", { shown: visible.length, total: ROADMAP_ITEMS.length })}
          </span>
        </div>
      </div>

      <section className={styles.list}>
        <div className={`${styles.container} ${styles.groups}`}>
          {groups.map(({ state, items }) => (
            <section key={state} aria-labelledby={`roadmap-${state}`} data-state={state}>
              <div className={styles.groupHead}>
                <h2 id={`roadmap-${state}`} className={styles.groupTitle}>
                  <span className={styles.swatchLg} aria-hidden />
                  {t(`status.${state}`)}
                </h2>
                <span className={styles.mono}>{t("page.count", { count: items.length })}</span>
                <span className={styles.groupHint}>{hint(state)}</span>
              </div>
              <div className={styles.columns} aria-hidden>
                <span>{t("page.columns.feature")}</span>
                <span>{t("page.columns.mac")}</span>
                <span>{t("page.columns.win")}</span>
              </div>
              <ul className={styles.rows}>
                {items.map((item) => (
                  <RoadmapRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}

function RoadmapRow({ item }: { item: RoadmapItem }) {
  const t = useTranslations("roadmap");
  const Icon = item.icon;

  return (
    <li className={styles.row} style={cssVars({ "--rm-area": ROADMAP_AREAS[item.area] })}>
      <div className={styles.rowMain}>
        <span className={styles.rowIcon} aria-hidden>
          <Icon size={17} />
        </span>
        <div className={styles.rowText}>
          <div className={styles.rowTitleLine}>
            <h3 className={styles.rowTitle}>{t(`items.${item.id}.title`)}</h3>
            <span className={styles.area}>{t(`areas.${item.area}`)}</span>
          </div>
          <p className={styles.rowDesc}>{t(`items.${item.id}.description`)}</p>
          {"note" in item && (
            <p className={styles.note}>
              <Info size={12} className={styles.noteIcon} aria-hidden />
              {t(`items.${item.id}.note`)}
            </p>
          )}
        </div>
      </div>
      {ROADMAP_PLATFORMS.map((platform) => (
        <div key={platform} className={styles.cell}>
          {/* Phones stack the cells, so they name their platform themselves. */}
          <span className={styles.cellPlatform}>
            <PlatformIcon platform={platform} size={12} />
            {t(`platforms.${platform}.name`)}
          </span>
          <StateCell state={item[platform]} label={t(`status.${item[platform]}`)} />
        </div>
      ))}
    </li>
  );
}

/** What each state means, in one line each. */
export function RoadmapLegend() {
  const t = useTranslations("roadmap");

  return (
    <section className={styles.legend}>
      <div className={`${styles.container} ${styles.legendInner}`}>
        <span className={styles.eyebrow}>{t("legend.title")}</span>
        {ROADMAP_STATES.map((state) => (
          <span key={state} className={styles.legendItem}>
            <StateCell state={state} label={t(`status.${state}`)} />
            {t(`legend.${state}`)}
          </span>
        ))}
      </div>
    </section>
  );
}

const STEPS = ["s1", "s2", "s3"] as const;

/**
 * Windows, said plainly: on its way, not downloadable. The design's "Download
 * for Windows (beta)" button waits for the installer on the download feed
 * (Windows release design, decision 9); until then the primary action is the
 * Mac download that exists.
 */
export function WindowsComingSoon() {
  const t = useTranslations("roadmap");

  return (
    <section id="windows" className={styles.windows}>
      <div className={`kl-glow ${styles.windowsGlow}`} aria-hidden />
      <div className={`${styles.container} ${styles.windowsInner}`}>
        <div className={styles.windowsCopy}>
          <div className={styles.windowsEyebrow}>
            <span className={styles.eyebrow}>{t("windows.eyebrow")}</span>
            <span className={styles.soonBadge}>{t("windows.badge")}</span>
          </div>
          <h2 className={styles.h2}>{t("windows.title")}</h2>
          <p className={styles.h2Serif}>{t("windows.serif")}</p>
          <p className={styles.windowsBody}>{t("windows.body")}</p>
          <a href={downloadUrls.macArm64} className={styles.download}>
            <Apple size={16} aria-hidden />
            {t("windows.download")}
          </a>
          <p className={styles.requirements}>{t("windows.requirements")}</p>
        </div>

        <div className={styles.smartscreen}>
          <div className={styles.smartscreenHead}>
            <span className={styles.smartscreenIcon} aria-hidden>
              <ShieldAlert size={17} />
            </span>
            <div>
              <h3 className={styles.smartscreenTitle}>{t("windows.smartscreenTitle")}</h3>
              <p className={styles.smartscreenBody}>{t("windows.smartscreenBody")}</p>
            </div>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step} className={styles.step}>
                <div className={styles.stepHead}>
                  <span className={styles.stepNumber}>{i + 1}</span>
                  {t(`windows.steps.${step}`)}
                </div>
                <div className={styles.mock} aria-hidden>
                  <StepMock step={step} />
                </div>
              </li>
            ))}
          </ol>
          <p className={styles.betaNote}>
            <TriangleAlert size={13} className={styles.betaNoteIcon} aria-hidden />
            {t("windows.betaNote")}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * A picture of the Windows dialogs, not Kaipu's UI — so these keep Windows'
 * own colours in both themes, like the third-party content in the home's mockups.
 */
function StepMock({ step }: { step: (typeof STEPS)[number] }) {
  const t = useTranslations("roadmap");

  if (step === "s1") {
    return (
      <>
        <div className={styles.mockTitle}>{t("windows.mock.protected")}</div>
        <div className={styles.mockText}>{t("windows.mock.prevented")}</div>
        <div className={styles.mockLink}>{t("windows.mock.moreInfo")}</div>
      </>
    );
  }
  if (step === "s2") {
    return (
      <>
        <div className={styles.mockText}>{t("windows.mock.app")}</div>
        <div className={styles.mockText}>{t("windows.mock.publisher")}</div>
        <div className={styles.mockButtons}>
          <span className={styles.mockBtn} data-primary>
            {t("windows.mock.runAnyway")}
          </span>
          <span className={styles.mockBtn}>{t("windows.mock.dontRun")}</span>
        </div>
      </>
    );
  }
  return (
    <div className={styles.mockInstall}>
      <KaipuLogo use="product" size={30} />
      <div>
        <div className={styles.mockTitle}>{t("windows.mock.installs")}</div>
        <div className={styles.mockText}>{t("windows.mock.tray")}</div>
      </div>
    </div>
  );
}
