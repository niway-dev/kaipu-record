import React from "react";
import { useNavigate } from "react-router-dom";
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

/** Strip of recent screenshots shown under the capture card. Hidden when empty.
 *  Each opens the library detail for that screenshot. */
export function RecentScreenshots(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { shots } = useRecentScreenshots(4);
  if (shots.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Recientes</h2>
      <div className={styles.grid}>
        {shots.map((shot) => (
          <button
            key={shot.id}
            type="button"
            className={styles.card}
            title={shot.title}
            onClick={() => navigate(`/library/${shot.id}`)}
          >
            <div className={styles.poster}>
              {shot.thumbnailUrl && <img src={shot.thumbnailUrl} alt={shot.title} />}
            </div>
            <div className={styles.meta}>
              <span className={styles.cardTitle}>{shot.title}</span>
              <span className={styles.cardSub}>{formatShotMeta(shot.createdAt)}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
