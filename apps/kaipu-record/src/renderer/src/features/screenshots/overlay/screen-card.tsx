import { useEffect, useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { CaptureOverlayBridge } from "@shared/types/electron-api";
import type { CaptureAction } from "@shared/types/screenshot-capture";
import type { SendAnswer } from "./capture-overlay";
import { actionForKey, primaryAction } from "./overlay-keys";
import type { OverlayQuery } from "./overlay-query";
import { ActionButtons, keepPointer, ModeRow, type OverlayChrome } from "./selection-chrome";
import styles from "./capture-overlay.module.css";

interface ScreenCardProps {
  query: OverlayQuery;
  bridge: CaptureOverlayBridge;
  /** Main's word on which display the pointer is over; only that one highlights. */
  hoverDisplayId: number | null;
  chrome: OverlayChrome;
  send: SendAnswer;
}

/**
 * Screen mode: each overlay shows one card for its display — number, "Display n",
 * `W × H · Built-in/External`, Capture · n and Copy, the mode row, and the reserved
 * "Record this display · soon". A click anywhere on the display captures it. Enter and
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

  useEffect(() => {
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
      <div className={styles.screenCard} data-testid="screen-card">
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
        <div className={styles.cardButtons} {...keepPointer}>
          <ActionButtons
            chrome={chrome}
            onAction={(action) => answer(action)}
            captureLabel={{
              text: t("overlay.captureNumber", { index }),
              aria: t("overlay.captureDisplay", { index }),
            }}
          />
        </div>
        <ModeRow chrome={chrome} />
      </div>
    </div>
  );
}
