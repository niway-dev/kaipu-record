import React from "react";
import { useRecentScreenshots } from "./use-recent-screenshots";
import styles from "./recent-screenshots.module.css";

/** Neutral-Spanish meta line, e.g. "Hoy 15:02 · PNG" / "Ayer 11:48 · PNG". */
function formatShotMeta(createdAt: number): string {
  const date = new Date(createdAt);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  let day: string;
  if (date.toDateString() === now.toDateString()) day = `Hoy ${time}`;
  else if (date.toDateString() === yesterday.toDateString()) day = `Ayer ${time}`;
  else day = date.toLocaleDateString("es");

  return `${day} · PNG`;
}

/** Strip of recent screenshots shown under the capture card. Hidden when empty. */
export function RecentScreenshots(): React.JSX.Element | null {
  const { shots } = useRecentScreenshots();
  if (shots.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Recientes</h2>
      <div className={styles.grid}>
        {shots.map((shot) => (
          <figure key={shot.id} className={styles.card}>
            <div className={styles.poster}>
              {shot.thumbnailUrl && <img src={shot.thumbnailUrl} alt={shot.title} />}
            </div>
            <figcaption className={styles.meta}>
              <span className={styles.cardTitle}>{shot.title}</span>
              <span className={styles.cardSub}>{formatShotMeta(shot.createdAt)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
