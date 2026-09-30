import { Search } from "lucide-react";

import styles from "./mocks.module.css";
import { cssVars } from "./css-vars";

/**
 * Chapter 04 — the library: recordings and screenshots side by side, each with
 * the badge that says which it is, plus the search card showing that last
 * month's explanation is still one query away.
 *
 * Every thumbnail tint is a literal here rather than a chapter token: these are
 * six different captures, not six chapters, so they should not move when a
 * chapter's tint changes.
 */
const ITEMS = [
  {
    kind: "rec",
    name: "Payment fails on step 3",
    sub: "Today · 48 MB",
    stamp: "2:14",
    tint: "#3b0d1e",
  },
  { kind: "shot", name: "Turn on mentions", sub: "Today · 1.2 MB", stamp: "PNG", tint: "#7c3aed" },
  {
    kind: "rec",
    name: "Rotate the API key",
    sub: "Yesterday · 11 MB",
    stamp: "0:29",
    tint: "#1c1c22",
  },
  { kind: "shot", name: "Onboarding step 2", sub: "Mon · 0.9 MB", stamp: "PNG", tint: "#1d4ed8" },
  {
    kind: "rec",
    name: "Sprint review — June",
    sub: "Jun 13 · 512 MB",
    stamp: "28:03",
    tint: "#1c1c22",
  },
  {
    kind: "shot",
    name: "Checkout redesign notes",
    sub: "Jun 9 · 2.1 MB",
    stamp: "PNG",
    tint: "#ea580c",
  },
] as const;

export function MockFind() {
  return (
    <div style={{ position: "relative" }}>
      <div className={`${styles.windowDark} kl-window`}>
        <div className={styles.library}>
          <div className={styles.libTop}>
            <span className={styles.search}>
              <Search size={14} />
              Search recordings and screenshots
            </span>
            <span className={styles.filters}>
              <span className={`${styles.filter} ${styles.filterActive}`}>All</span>
              <span className={styles.filter}>Recordings</span>
              <span className={styles.filter}>Screenshots</span>
            </span>
          </div>

          <div className={styles.cards}>
            {ITEMS.map((item) => (
              <div key={item.name} className={styles.card}>
                <div className={styles.thumb} style={{ background: item.tint }}>
                  <span
                    className={`${styles.badge} ${
                      item.kind === "rec" ? styles.badgeRec : styles.badgeShot
                    }`}
                  >
                    {item.kind === "rec" ? "● REC" : "▣ SHOT"}
                  </span>
                  <span className={styles.thumbSheet}>
                    <span className={styles.thumbLine} style={{ width: "80%" }} />
                    <span className={styles.thumbLine} style={{ width: "55%" }} />
                    <span className={styles.thumbAccent} />
                  </span>
                  <span className={styles.stamp}>{item.stamp}</span>
                </div>
                <div className={styles.cardMeta}>
                  <div className={styles.cardName}>{item.name}</div>
                  <div className={styles.cardSub}>{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`${styles.searchCard} kl-float-card`}
        style={cssVars({ "--kl-tint": "var(--kl-c4)" })}
      >
        <span className={styles.searchField}>
          <Search size={14} />
          checkout
        </span>
        <div className={styles.searchMeta}>2 results · explained 3 weeks ago</div>
      </div>
    </div>
  );
}
