import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { CaptureOverlayBridge } from "@shared/types/electron-api";
import type { SendAnswer } from "./capture-overlay";
import type { OverlayQuery } from "./overlay-query";
import styles from "./capture-overlay.module.css";

interface ScreenChooserProps {
  query: OverlayQuery;
  bridge: CaptureOverlayBridge;
  send: SendAnswer;
}

/**
 * Screen mode with several displays: each overlay says "Capture this display · N".
 * Clicking anywhere on it, or pressing N, captures this display. The pointer's display
 * is reported to main, which broadcasts it back, so exactly one display highlights.
 */
export function ScreenChooser({ query, bridge, send }: ScreenChooserProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { displayId, index } = query;
  const [hoverDisplayId, setHoverDisplayId] = useState<number | null>(null);
  // What this window last told main, so a pointer move sends one message, not hundreds.
  const reported = useRef<number | null>(null);

  useEffect(() => bridge.onState((state) => setHoverDisplayId(state.hoverDisplayId)), [bridge]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== String(index)) return;
      event.preventDefault();
      send({ kind: "display", displayId });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayId, index, send]);

  const report = (next: number | null): void => {
    if (reported.current === next) return;
    reported.current = next;
    bridge.hover(next);
  };

  const pick = (): void => send({ kind: "display", displayId });

  return (
    <div
      className={`${styles.sheet} ${styles.chooser}`}
      data-highlighted={hoverDisplayId === displayId}
      onPointerEnter={() => report(displayId)}
      onPointerMove={() => report(displayId)}
      onPointerLeave={() => report(null)}
      onClick={pick}
    >
      <button type="button" className={styles.chooserLabel}>
        {t("overlay.captureDisplay", { index })}
      </button>
    </div>
  );
}
