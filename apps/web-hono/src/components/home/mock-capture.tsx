import { ArrowUpRight, Copy, Droplet, MousePointer2, Square, Type } from "lucide-react";

import styles from "./mocks.module.css";

/**
 * Chapter 02 — a screenshot that explains itself: a settings screen framed on
 * the chapter's tint, one row boxed and highlighted, a handwritten note pointing
 * at it, the owner's email blurred, and the editor toolbar below.
 *
 * The owner line is a blurred placeholder bar rather than a real address — a
 * marketing page should not ship a person's email, even a made-up one that
 * looks real.
 */
export function MockCapture() {
  const rows = [
    { name: "Weekly digest", meta: "Every Monday at 9:00", on: false, marked: false },
    { name: "Deploy alerts", meta: "When a release fails", on: false, marked: true },
    { name: "Mentions", meta: "Email and push", on: true, marked: false },
  ];

  return (
    <div style={{ position: "relative" }}>
      <div className={`${styles.framed} kl-window`}>
        <div className={styles.window}>
          <div className={styles.bar}>
            <div className={styles.lights}>
              <span className={`${styles.light} ${styles.red}`} />
              <span className={`${styles.light} ${styles.amber}`} />
              <span className={`${styles.light} ${styles.green}`} />
            </div>
            <span className={styles.barTitle}>Team settings</span>
          </div>

          <div className={styles.sheet}>
            <div className={styles.h}>Notifications</div>
            <div className={styles.sub}>
              Owner: <span className={styles.redacted} />
            </div>

            {rows.map((row) => (
              <div
                key={row.name}
                className={`${styles.toggleRow} ${row.marked ? styles.toggleRowMarked : ""}`}
              >
                <div>
                  <div className={styles.toggleName}>{row.name}</div>
                  <div className={styles.toggleMeta}>{row.meta}</div>
                </div>
                <span className={`${styles.switch} ${row.on ? styles.switchOn : ""}`} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <span className={styles.hand}>turn this on!</span>

      <div className={`${styles.toolbar} kl-float-card`}>
        <span className={styles.tool}>
          <MousePointer2 size={15} />
        </span>
        <span className={`${styles.tool} ${styles.toolActive}`}>
          <Square size={15} />
        </span>
        <span className={styles.tool}>
          <ArrowUpRight size={15} />
        </span>
        <span className={styles.tool}>
          <Type size={15} />
        </span>
        <span className={styles.tool}>
          <Droplet size={15} />
        </span>
        <span className={styles.copyBtn}>
          <Copy size={13} /> Copy
        </span>
      </div>
    </div>
  );
}
