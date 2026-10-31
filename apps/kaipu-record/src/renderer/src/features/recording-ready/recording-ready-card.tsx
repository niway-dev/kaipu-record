import { useEffect, useRef, useState } from "react";
import type { RecordingReadyPayload } from "@shared/types/recording-ready";
import type { RecordingReadyCardBridge } from "@shared/types/electron-api";
import { PostRecordingCard } from "@renderer/features/status-cards/post-recording-card";
import styles from "./recording-ready-card.module.css";

interface RecordingReadyCardProps {
  /** Injected by tests; the window's bridge otherwise. */
  api?: RecordingReadyCardBridge;
}

/**
 * Root of the "Your video is ready" window (`?window=recording-ready`), floating on the
 * desktop after a take. The same `PostRecordingCard` the recording page falls back to; it
 * only renders main's payload and reports presses. Main closes the window and takes the
 * main window where the press goes. The card's height is reported so the window fits it.
 */
export function RecordingReadyCard({
  api = window.electronAPI.recordingReadyCard,
}: RecordingReadyCardProps): React.JSX.Element | null {
  const [payload, setPayload] = useState<RecordingReadyPayload | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = api.onShow(setPayload);
    // After subscribing: main sends the current payload in answer.
    api.ready();
    return unsubscribe;
  }, [api]);

  // Escape closes it, once the user has clicked into the card (it never takes focus itself).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") api.action({ kind: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  const visible = payload !== null;
  useEffect(() => {
    const element = frame.current;
    if (!visible || !element) return;
    const report = (): void => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) api.resize(height);
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [api, visible]);

  if (!payload) return null;

  return (
    <div ref={frame} className={styles.frame}>
      <PostRecordingCard
        // A new payload is a new recording: start the card over (its pop-in included).
        key={payload.assetId}
        durationSeconds={payload.durationSeconds}
        dimensions={payload.dimensions}
        sizeBytes={payload.sizeBytes}
        onPick={(destination) => api.action({ kind: "pick", destination })}
        onEditFirst={payload.canEdit ? () => api.action({ kind: "edit" }) : undefined}
        onDismiss={() => api.action({ kind: "dismiss" })}
        onOpen={() => api.action({ kind: "open" })}
      />
    </div>
  );
}
