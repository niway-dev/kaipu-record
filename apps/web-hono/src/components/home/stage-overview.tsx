import { Camera, ChevronsUpDown, Folder, Mic, MousePointer2 } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";

import { workspaceFolder } from "./hero-stage-model";
import styles from "./hero-stage.module.css";
import { SampleScreen, workspaceName, type T } from "./stage-parts";

/**
 * What the screen shows on a phone's overview: the sample page with the four
 * things Kaipu does drawn on it — a capture selection with a cursor on its
 * corner, an arrow annotation, the camera bubble and the recording bar.
 *
 * It is a still picture, not a fifth step: nothing in it is a control, nothing
 * ticks, and it holds nothing, so the auto demo is never kept waiting by it.
 * Desktop has no use for it (the brand statement is the overview there), so CSS
 * shows it below 1080px only. The whole picture is `aria-hidden`: the section's
 * headline and caption already say what it shows.
 */
export function OverviewPreview({ t }: { t: T }) {
  const name = workspaceName(t, "personal");
  return (
    <div className={styles.preview} aria-hidden="true">
      {/* The same top bar every step has, so the picture is as tall as the steps and nothing below it jumps. */}
      <div className={styles.wsBar}>
        <span className={styles.wsButton}>
          <span className={styles.wsTile} style={{ background: "var(--kl-c1)" }}>
            P
          </span>
          <span className={styles.wsName}>{name}</span>
          <ChevronsUpDown size={13} />
        </span>
        <span className={styles.wsSaving}>
          <Folder size={13} />
          <span className={styles.wsLabel}>{t("homeStageWorkspaceSavingTo")}</span>
          <span className={styles.wsPath}>{workspaceFolder("personal", name)}</span>
        </span>
      </div>
      <div className={styles.screen}>
        <SampleScreen t={t} />
        <span className={styles.previewFrame}>
          <i />
          <i />
          <i />
          <i />
          <MousePointer2 className={styles.previewCursor} size={20} />
        </span>
        <svg className={styles.previewArrow} viewBox="0 0 64 40" fill="none">
          <path
            d="M4 34 C18 30 34 22 52 8 M52 8 L40 9 M52 8 L50 20"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className={styles.bubble}>
          <KaipuLogo use="product" size={120} className={styles.bubbleFox} />
        </div>
        <div className={styles.dock}>
          <span className={styles.timer}>
            <span className={`${styles.recDot} ${styles.recDotLive}`} />
            00:12
          </span>
          <span className={styles.dockIcon}>
            <Mic size={16} />
          </span>
          <span className={styles.dockIcon}>
            <Camera size={16} />
          </span>
          <span className={`${styles.dockIcon} ${styles.stop}`}>
            <span className={styles.previewStop} />
          </span>
        </div>
      </div>
    </div>
  );
}
