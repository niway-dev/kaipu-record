import { useEffect, useRef } from "react";
import { Camera, Lock, Mic, Volume2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { CaptureOverlayBridge } from "@shared/types/electron-api";
import type { CaptureAction } from "@shared/types/screenshot-capture";
import type { SendAnswer } from "./capture-overlay";
import { actionForKey, primaryAction } from "./overlay-keys";
import type { OverlayQuery } from "./overlay-query";
import {
  ActionButtons,
  IntentSwitch,
  keepPointer,
  ModeRow,
  type OverlayChrome,
} from "./selection-chrome";
import type { OverlayToggles } from "./record-chrome";
import styles from "./capture-overlay.module.css";

/** Compact Mic · System · Cam chips on the Screen card opened to record. */
function CardInputs({ toggles }: { toggles: OverlayToggles }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const tCamera = useTranslations("cameraSettings");
  const chips = [
    { key: "isMicrophoneEnabled", on: toggles.microphone, icon: Mic, label: t("overlay.chipMic") },
    {
      key: "isSystemAudioEnabled",
      on: toggles.systemAudio,
      icon: Volume2,
      label: t("overlay.chipSystem"),
    },
    { key: "isCameraEnabled", on: toggles.camera, icon: Camera, label: t("overlay.chipCamera") },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t("overlay.inputs")}
      className={styles.cardInputs}
      {...keepPointer}
    >
      {chips.map(({ key, on, icon, label }) => {
        // A blocked camera reads off and cannot turn on (same rule as the widget).
        const blocked = key === "isCameraEnabled" && toggles.cameraBlocked;
        const cannotToggle = blocked && !on;
        const Icon = blocked ? Lock : icon;
        return (
          <button
            key={key}
            type="button"
            className={styles.cardInput}
            aria-pressed={on}
            aria-disabled={cannotToggle || undefined}
            aria-label={blocked ? tCamera("blockedTile") : undefined}
            title={blocked ? tCamera("blockedBody") : undefined}
            data-blocked={blocked || undefined}
            onClick={cannotToggle ? undefined : () => toggles.toggle(key)}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

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
 * `W × H · Built-in/External`, Capture · n, Copy and Record, and the mode row. Opened to
 * record, the card is "● Record this display", the mode row and the Mic · System · Cam
 * chips. A click anywhere on the display answers the primary action. Enter and
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
          <span className={styles.cardIntent}>
            <IntentSwitch chrome={chrome} />
          </span>
        </div>
        {chrome.intent === "record" ? (
          <>
            <div className={styles.cardButtons} {...keepPointer}>
              <button
                type="button"
                className={`${styles.captureButton} ${styles.cardRecord}`}
                aria-label={t("overlay.recordDisplay")}
                onClick={() => answer("record")}
              >
                <span className={styles.startDot} aria-hidden />
                {t("overlay.recordDisplay")}
              </button>
            </div>
            <ModeRow chrome={chrome} />
            {chrome.toggles && <CardInputs toggles={chrome.toggles} />}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
