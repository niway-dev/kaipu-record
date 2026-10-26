import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { formatDuration } from "@renderer/features/library/format";
import { RecordingCaptureTag } from "@renderer/features/library/components/recording-capture-tag";
import type { LocalRecording } from "@shared/types/library-storage";
// The same strip as the Screenshots page's Recent, so both pages read alike.
import styles from "@renderer/features/screenshots/recent-screenshots.module.css";
import own from "./recent-recordings.module.css";

/**
 * The newest recordings in the vault, newest first. Re-read on window focus so a take that
 * just finished shows when the user comes back to the Record page.
 */
export function useRecentRecordings(limit = 4): LocalRecording[] {
  const [items, setItems] = useState<LocalRecording[]>([]);
  const refresh = useCallback(() => {
    void window.electronAPI
      .listLocalRecordings()
      .then((all) =>
        setItems(
          all
            .filter((item) => item.kind === "recording")
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit),
        ),
      )
      .catch(() => setItems([]));
  }, [limit]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return items;
}

/**
 * "Recent" under the Record card: the last four recordings with their duration, title and
 * "Today 3:02 PM · MP4", plus the capture tag ("FRAME · 16:9", "SCREEN", "WINDOW") on the
 * thumbnail. Hidden when there are none. Recordings made before capture metadata existed
 * have no tag.
 */
export function RecentRecordings(): React.JSX.Element | null {
  const navigate = useNavigate();
  const locale = useLocale();
  const t = useTranslations("record");
  const tShots = useTranslations("screenshots");
  const items = useRecentRecordings(4);
  if (items.length === 0) return null;

  const day = (createdAt: number): string => {
    const date = new Date(createdAt);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === now.toDateString()) return `${tShots("today")} ${time}`;
    if (date.toDateString() === yesterday.toDateString()) return `${tShots("yesterday")} ${time}`;
    return date.toLocaleDateString(locale);
  };

  return (
    <section className={styles.section} data-testid="recent-recordings">
      <h2 className={styles.heading}>{t("recent")}</h2>
      <div className={styles.grid}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.card}
            title={item.title}
            onClick={() => navigate(`/library/${item.assetId}`)}
          >
            <div className={`${styles.poster} ${own.poster}`}>
              {item.thumbnailUrl && <img src={item.thumbnailUrl} alt={item.title} />}
              <RecordingCaptureTag capture={item.capture} className={own.capture} />
              {item.durationSeconds > 0 && (
                <span className={own.duration}>{formatDuration(item.durationSeconds)}</span>
              )}
            </div>
            <div className={styles.meta}>
              <span className={styles.cardTitle}>{item.title}</span>
              <span className={styles.cardSub}>
                {t("recentMeta", { date: day(item.createdAt) })}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
