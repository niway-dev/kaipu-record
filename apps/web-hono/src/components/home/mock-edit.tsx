import { Play, Sparkles } from "lucide-react";

import styles from "./mocks.module.css";

/**
 * Chapter 03 — the editor mid-edit: a zoom following a click on the stage, the
 * four-track timeline underneath (clips, zooms, privacy, audio), and the auto
 * zoom card explaining where the suggestions came from.
 *
 * The timeline lanes are laid out with flex weights rather than absolute
 * positions, so they stay proportional at any width instead of drifting out of
 * the window on a narrow screen.
 */
export function MockEdit() {
  return (
    <div style={{ position: "relative" }}>
      <div className={`${styles.windowDark} kl-window`}>
        <div className={styles.barDark}>
          <div className={styles.lights}>
            <span className={`${styles.light} ${styles.red}`} />
            <span className={`${styles.light} ${styles.amber}`} />
            <span className={`${styles.light} ${styles.green}`} />
          </div>
        </div>

        <div className={styles.stageFrame}>
          <div className={styles.stageInner}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1f2937" }}>Billing &amp; API</div>
            <div className={styles.apiRow}>API key hidden</div>
            <div className={styles.zoomBox}>
              <span className={styles.zoomTag}>2.0× · FOLLOW</span>
              <div style={{ display: "flex" }}>
                <span className={styles.zoomCta} />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.timeline}>
          <div className={styles.transport}>
            <span className={styles.playBtn}>
              <Play size={13} fill="currentColor" />
            </span>
            <span className={styles.time}>0:20.6 / 0:29.0</span>
          </div>

          <div className={styles.track}>
            <span className={styles.trackName}>CLIPS</span>
            <span className={styles.trackLane}>
              {Array.from({ length: 11 }, (_, i) => (
                <span key={i} className={styles.clip} />
              ))}
            </span>
          </div>

          <div className={styles.track}>
            <span className={styles.trackName}>ZOOMS</span>
            <span className={styles.trackLane}>
              <span style={{ flex: 1 }} />
              <span className={styles.zoomChip} style={{ flex: 3 }}>
                2.0×
              </span>
              <span style={{ flex: 1 }} />
              <span className={styles.zoomChip} style={{ flex: 2 }}>
                1.4×
              </span>
              <span style={{ flex: 1 }} />
              <span className={styles.zoomChip} style={{ flex: 3 }}>
                2.0×
              </span>
            </span>
          </div>

          <div className={styles.track}>
            <span className={styles.trackName}>PRIVACY</span>
            <span className={styles.trackLane}>
              <span style={{ flex: 2 }} />
              <span className={styles.privacyChip} style={{ flex: 2, background: "#2563eb" }}>
                BLUR
              </span>
              <span style={{ flex: 3 }} />
              <span className={styles.privacyChip} style={{ flex: 2, background: "#6b7280" }}>
                COVER
              </span>
              <span style={{ flex: 1 }} />
            </span>
          </div>

          <div className={styles.track}>
            <span className={styles.trackName}>AUDIO</span>
            <span className={styles.trackLane}>
              <span className={styles.privacyChip} style={{ flex: 2, background: "#374151" }}>
                MUTED
              </span>
              {Array.from({ length: 22 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    alignSelf: "center",
                    // A fixed pattern, not Math.random: the server and the client
                    // must render the same bars or hydration mismatches.
                    height: `${6 + ((i * 37) % 13)}px`,
                    borderRadius: 2,
                    background: i > 15 ? "var(--kl-pink)" : "#3b82f6",
                  }}
                />
              ))}
            </span>
          </div>
        </div>
      </div>

      <div className={`${styles.autoCard} kl-float-card`}>
        <div className={styles.autoHead}>
          <Sparkles size={15} color="var(--kl-pink-tx)" />
          Auto zoom
        </div>
        <div className={styles.autoBody}>3 zooms suggested from 17 clicks and 8 pauses.</div>
        <div className={styles.autoChips}>
          <span className={styles.autoChip}>2.0×</span>
          <span className={styles.autoChip}>1.4×</span>
          <span className={styles.autoChip}>2.0×</span>
        </div>
      </div>
    </div>
  );
}
