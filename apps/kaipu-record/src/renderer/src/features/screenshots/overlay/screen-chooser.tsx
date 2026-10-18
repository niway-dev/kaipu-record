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
 * Clicking anywhere on it captures this display. Pressing N on whichever overlay has
 * keyboard focus captures the N-th display (`ids` from the query). The pointer's display
 * is reported to main, which broadcasts it back, so exactly one display highlights.
 */
export function ScreenChooser({ query, bridge, send }: ScreenChooserProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { displayId, index, ids } = query;
  const [hoverDisplayId, setHoverDisplayId] = useState<number | null>(null);
  // What main believes is hovered, as far as this window knows: a pointer move resends
  // only when it disagrees, so moves cost one message, not hundreds.
  const reported = useRef<number | null>(null);

  useEffect(
    () =>
      bridge.onState((state) => {
        // Main's word wins: if another window's late "left" cleared our hover, the next
        // pointer move here must report this display again.
        reported.current = state.hoverDisplayId;
        setHoverDisplayId(state.hoverDisplayId);
      }),
    [bridge],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!/^[1-9]$/.test(event.key)) return;
      const picked = ids[Number(event.key) - 1];
      if (picked === undefined) return;
      event.preventDefault();
      send({ kind: "display", mode: "screen", action: "capture", displayId: picked });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ids, send]);

  const report = (next: number | null): void => {
    if (reported.current === next) return;
    reported.current = next;
    bridge.hover(next);
  };

  const pick = (): void => send({ kind: "display", mode: "screen", action: "capture", displayId });

  return (
    <div
      className={`${styles.sheet} ${styles.chooser}`}
      data-highlighted={hoverDisplayId === displayId}
      onPointerEnter={() => report(displayId)}
      onPointerMove={() => report(displayId)}
      onPointerLeave={() => report(null)}
      onClick={pick}
    >
      {/* The label alone names the button: the number tile and the size are decoration. */}
      <button
        type="button"
        className={styles.chooserPill}
        aria-label={t("overlay.captureDisplay", { index })}
      >
        <span className={styles.chooserNumber} aria-hidden>
          {index}
        </span>
        <span className={styles.chooserText} aria-hidden>
          <span className={styles.chooserTitle}>{t("overlay.captureDisplay", { index })}</span>
          {/* DIP size from the query; the physical pixel count is not known here. */}
          <span className={styles.chooserSize}>
            {query.bounds.width} × {query.bounds.height}
          </span>
        </span>
      </button>
    </div>
  );
}
