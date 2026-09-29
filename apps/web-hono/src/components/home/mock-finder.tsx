import { Folder, PanelLeft, Sidebar } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";

import styles from "./mock-finder.module.css";

/**
 * "Your files" — the Kaipu folder open in Finder.
 *
 * The section's whole claim is that there is nothing proprietary here, so the
 * mockup is deliberately an OS file browser rather than a Kaipu screen: the
 * point lands because the window is not ours.
 */
interface MockFile {
  name: string;
  kind: string;
  size: string;
  type: "MP4" | "PNG";
  /** One row is selected, the way a Finder window looks just after a click. */
  selected?: boolean;
}

const FILES: readonly MockFile[] = [
  { name: "checkout-bug.mp4", kind: "MPEG-4", size: "48 MB", type: "MP4", selected: true },
  { name: "turn-on-mentions.png", kind: "PNG image", size: "1.2 MB", type: "PNG" },
  { name: "rotate-api-key.mp4", kind: "MPEG-4", size: "11 MB", type: "MP4" },
  { name: "onboarding-step-2.png", kind: "PNG image", size: "0.9 MB", type: "PNG" },
  { name: "sprint-review-june.mp4", kind: "MPEG-4", size: "512 MB", type: "MP4" },
  { name: "checkout-redesign.png", kind: "PNG image", size: "2.1 MB", type: "PNG" },
];

export function MockFinder() {
  return (
    <div style={{ position: "relative" }}>
      <div className={`${styles.window} kl-window`}>
        <div className={styles.side}>
          <div className={styles.lights}>
            <span className={`${styles.light} ${styles.red}`} />
            <span className={`${styles.light} ${styles.amber}`} />
            <span className={`${styles.light} ${styles.green}`} />
          </div>
          <div className={styles.sideHead}>Favourites</div>
          {["Desktop", "Documents"].map((name) => (
            <div key={name} className={styles.sideRow}>
              <Folder size={14} color="#4d9fff" />
              {name}
            </div>
          ))}
          <div className={styles.sideRow}>
            <Sidebar size={14} color="#4d9fff" />
            Movies
          </div>
          {/* Kaipu is just another folder in the sidebar — that is the argument. */}
          <div className={`${styles.sideRow} ${styles.sideRowActive}`}>
            <KaipuLogo use="product" size={15} />
            Kaipu
          </div>
        </div>

        <div className={styles.list}>
          <div className={styles.path}>
            <span className={styles.pathName}>Kaipu</span>
            <span className={styles.pathDim}>~/Movies/Kaipu</span>
          </div>

          <div className={styles.head}>
            <span>Name</span>
            <span>Kind</span>
            <span>Size</span>
          </div>

          {FILES.map((file) => (
            <div
              key={file.name}
              className={`${styles.row} ${file.selected ? styles.rowSelected : ""}`}
            >
              <span className={styles.name}>
                <span
                  className={`${styles.chip} ${
                    file.type === "MP4" ? styles.chipMp4 : styles.chipPng
                  }`}
                >
                  {file.type}
                </span>
                {file.name}
              </span>
              <span className={styles.dim}>{file.kind}</span>
              <span className={styles.dim}>{file.size}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${styles.openWith} kl-float-card`}>
        <span className={styles.openIcon}>
          <PanelLeft size={16} />
        </span>
        <span>
          <span className={styles.openName}>checkout-bug.mp4</span>
          <span className={styles.openMeta}>Opens in QuickTime, VLC, Slack…</span>
        </span>
      </div>
    </div>
  );
}
