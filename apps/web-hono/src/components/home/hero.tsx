import { useRef, useState } from "react";
import { Apple, ArrowUpRight, Mail, MousePointer2, Monitor, Pause, Play } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { DownloadLink } from "@/components/download-link";
import { downloadUrls } from "@/lib/download";
import { HeroStage } from "./hero-stage";
import { HERO_MODES, type HeroMode } from "./hero-modes";
import { DEFAULT_WORKSPACE, type WorkspaceId } from "./hero-stage-model";
import { BrandStatement } from "./stage-parts";
import { useAutoDemo } from "./use-auto-demo";
import styles from "./hero.module.css";

const RING_RADIUS = 9;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The page's opening. On the overview the brand statement is the whole screen;
 * picking Record, Screenshot, Edit or Export turns the hero into a captured
 * screen (`HeroStage`) that the visitor can actually operate. The demo is
 * local: no camera, microphone, screen or network is ever touched. It plays
 * itself a step every ten seconds (a ring counts down, a button pauses it) and
 * waits whenever the visitor is using it, the tab is hidden or the hero is out of
 * view; with reduced motion it starts paused. Picking a step is always manual.
 *
 * On a phone the copy and download button come first, as they always did, and
 * the compact screen follows them.
 */
export function Hero() {
  const t = useTranslations("landing");
  const [mode, setMode] = useState<HeroMode>("overview");
  const [workspace, setWorkspace] = useState<WorkspaceId>(DEFAULT_WORKSPACE);
  const root = useRef<HTMLElement>(null);
  const auto = useAutoDemo({ mode, onAdvance: setMode, rootRef: root });
  /** A step the visitor picked: it always wins, and the countdown starts over. */
  const pick = (m: HeroMode) => {
    setMode(m);
    auto.restart();
  };
  const copy = {
    overview: { title: "", body: t("homeStageOverviewBody") },
    record: { title: t("homeStageRecordTitle"), body: t("homeStageRecordBody") },
    screenshot: { title: t("homeStageScreenshotTitle"), body: t("homeStageScreenshotBody") },
    edit: { title: t("homeStageEditTitle"), body: t("homeStageEditBody") },
    export: { title: t("homeStageExportTitle"), body: t("homeStageExportBody") },
  } satisfies Record<HeroMode, { title: string; body: string }>;
  const label = (m: HeroMode) =>
    ({
      overview: t("homeStageOverview"),
      record: t("homeStageRecord"),
      screenshot: t("homeStageScreenshot"),
      edit: t("homeStageEdit"),
      export: t("homeStageExport"),
    })[m];

  return (
    <section id="top" className={styles.hero} data-mode={mode} ref={root}>
      <div className={styles.grid}>
        <p className={styles.demoNote}>{t("homeStageDemo")}</p>
        <div
          className={styles.modes}
          role="group"
          aria-label={t("homeStageGroup")}
          {...auto.barProps}
        >
          {HERO_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.mode} ${m === mode ? styles.modeActive : ""}`}
              aria-pressed={m === mode}
              onClick={() => pick(m)}
            >
              {label(m)}
            </button>
          ))}
        </div>

        <div className={styles.auto} {...auto.barProps} data-status={auto.status}>
          <span className={styles.ring} aria-hidden>
            <svg viewBox="0 0 24 24" width="24" height="24">
              <circle className={styles.ringTrack} cx="12" cy="12" r={RING_RADIUS} />
              <circle
                className={styles.ringFill}
                cx="12"
                cy="12"
                r={RING_RADIUS}
                strokeDasharray={RING_LENGTH}
                strokeDashoffset={RING_LENGTH * (1 - auto.progress)}
              />
            </svg>
            <span className={styles.ringSeconds}>
              {auto.status === "running" ? auto.secondsLeft : ""}
            </span>
          </span>
          <span className={styles.autoText} data-testid="auto-status">
            {auto.status === "running"
              ? t("homeStageAutoNext", { step: label(auto.next), seconds: auto.secondsLeft })
              : auto.status === "paused"
                ? t("homeStageAutoPaused")
                : auto.status === "holding"
                  ? t("homeStageAutoHolding")
                  : t("homeStageAutoAway")}
          </span>
          <button
            type="button"
            className={styles.autoToggle}
            aria-label={auto.playing ? t("homeStageAutoPause") : t("homeStageAutoPlay")}
            aria-pressed={!auto.playing}
            onClick={auto.toggle}
          >
            {auto.playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          </button>
        </div>

        <div className={styles.copy} key={mode} aria-live="off">
          {mode === "overview" ? (
            <div className={styles.titleWrap}>
              <span className={styles.frame} aria-hidden>
                <i />
                <i />
                <i />
                <i />
                <MousePointer2 className={styles.cursor} size={22} />
              </span>
              <h1 className={styles.title}>
                <BrandStatement t={t} />
              </h1>
            </div>
          ) : (
            <h1 className={styles.title}>{copy[mode].title}</h1>
          )}
          <p className={styles.body}>{copy[mode].body}</p>
        </div>

        <HeroStage
          mode={mode}
          onMode={pick}
          workspace={workspace}
          onWorkspace={setWorkspace}
          onHold={auto.hold}
          stageProps={auto.stageProps}
        />

        <div className={styles.ctas}>
          {/* Two primaries swapped by CSS: a phone cannot install a .dmg, so it offers the link by mail. */}
          <DownloadLink
            placement="hero"
            href={downloadUrls.macArm64}
            className={`${styles.ctaPrimary} ${styles.deskOnly}`}
          >
            <Apple size={18} aria-hidden />
            {t("homeHeroCtaPrimary")}
            <ArrowUpRight size={17} aria-hidden />
          </DownloadLink>
          <DownloadLink
            placement="hero"
            href={downloadUrls.windowsX64}
            className={`${styles.ctaSecondary} ${styles.deskOnly}`}
          >
            <Monitor size={17} aria-hidden />
            {t("downloadWindowsBeta")}
          </DownloadLink>
          <a href="#download" className={`${styles.ctaPrimary} ${styles.mobileOnly}`}>
            <Mail size={17} aria-hidden />
            {t("homeHeroCtaMobile")}
          </a>
        </div>
        <p className={`${styles.footnote} ${styles.deskOnly}`}>{t("homeHeroFootnote")}</p>
        <p className={`${styles.footnote} ${styles.mobileOnly}`}>{t("homeHeroMobileNote")}</p>
      </div>
    </section>
  );
}
