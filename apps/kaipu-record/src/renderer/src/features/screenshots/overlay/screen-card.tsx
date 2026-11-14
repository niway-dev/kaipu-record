import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { CaptureOverlayBridge } from "@shared/types/electron-api";
import type { CaptureAction } from "@shared/types/screenshot-capture";
import type { SendAnswer } from "./capture-overlay";
import { CaptureWidget } from "./capture-widget";
import type { OverlayChrome } from "./overlay-chrome";
import { actionForKey, primaryAction } from "./overlay-keys";
import { workAreaInWindow, type OverlayQuery } from "./overlay-query";
import { devicePixelSize } from "./ratio-geometry";
import styles from "./capture-overlay.module.css";
import { uiArea } from "@renderer/lib/ui-area";

interface ScreenCardProps {
  query: OverlayQuery;
  bridge: CaptureOverlayBridge;
  /** Main's word on which display the pointer is over; only that one highlights. */
  hoverDisplayId: number | null;
  chrome: OverlayChrome;
  send: SendAnswer;
}

/**
 * Screen mode: each overlay shows a slim badge for its display (number, "Display n",
 * `W × H · Built-in/External`) and the capture widget docked to the bottom of its work area
 * (ADR 0056). A click anywhere on the display answers the primary action. Enter and
 * ⌘C / Ctrl+C capture or copy the hovered display (this one when none is hovered). The
 * pointer's display is reported to main, which broadcasts it back, so exactly one display
 * highlights.
 */
export function ScreenCard({
  query,
  bridge,
  hoverDisplayId,
  chrome,
  send,
}: ScreenCardProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { displayId, index } = query;
  // What main believes is hovered, as far as this window knows: a pointer move resends
  // only when it disagrees, so moves cost one message, not hundreds. Main's word wins: if
  // another window's late "left" cleared our hover, the next move here reports it again.
  const reported = useRef<number | null>(hoverDisplayId);
  useEffect(() => {
    reported.current = hoverDisplayId;
  }, [hoverDisplayId]);

  const answer = (action: CaptureAction, target: number = displayId): void =>
    send({ kind: "display", mode: "screen", action, displayId: target });

  const latest = useRef({ answer, hoverDisplayId });
  latest.current = { answer, hoverDisplayId };
  const platform = chrome.platform;
  const intent = chrome.intent;

  // Layout effect: the card hears Enter from the commit that paints it (see FrameBox).
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = actionForKey(event, platform, intent);
      if (!action) return;
      event.preventDefault();
      const { answer: send, hoverDisplayId: hovered } = latest.current;
      send(action, hovered ?? undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [platform, intent]);

  const report = (next: number | null): void => {
    if (reported.current === next) return;
    reported.current = next;
    bridge.hover(next);
  };

  const area = useMemo(() => workAreaInWindow(query), [query]);
  const pixels = devicePixelSize(query.bounds, query.scaleFactor ?? 1);
  const size = `${query.bounds.width} × ${query.bounds.height}`;
  const kind = query.internal ? t("overlay.builtIn") : t("overlay.external");

  return (
    <div
      className={`${styles.sheet} ${styles.chooser}`}
      data-testid="screen-card-sheet"
      data-highlighted={hoverDisplayId === displayId}
      onPointerEnter={() => report(displayId)}
      onPointerMove={() => report(displayId)}
      onPointerLeave={() => report(null)}
      onClick={() => answer(primaryAction(intent))}
    >
      <div
        {...uiArea("captureOverlay.screenCard")}
        className={styles.screenCard}
        data-testid="screen-card"
      >
        <div className={styles.cardHeader}>
          <span className={styles.chooserNumber} aria-hidden>
            {index}
          </span>
          <span className={styles.chooserText}>
            <span className={styles.chooserTitle}>{t("overlay.displayLabel", { index })}</span>
            {/* DIP size from the query; the physical pixel count is not known here. */}
            <span className={styles.chooserSize}>
              {size} · {kind}
            </span>
          </span>
        </div>
      </div>
      <CaptureWidget
        chrome={chrome}
        selection={null}
        area={area}
        ratio="free"
        size={pixels}
        canRecord
        onAction={(action) => answer(action)}
        devices={chrome.devices}
      />
    </div>
  );
}
