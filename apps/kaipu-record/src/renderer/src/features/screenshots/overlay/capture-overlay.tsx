import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type {
  CaptureAction,
  CaptureMode,
  CaptureRect,
  OverlayAnswer,
  OverlayState,
} from "@shared/types/screenshot-capture";
import { useTranslations } from "@kaipu/i18n";
import { FrameBox } from "./frame-box";
import { copyKeyLabel, detectKeyPlatform, modeForKey, type KeyPlatform } from "./overlay-keys";
import type { OverlayQuery } from "./overlay-query";
import { ScreenCard } from "./screen-card";
import type { OverlayChrome } from "./selection-chrome";
import { WindowPicker } from "./window-picker";
import styles from "./capture-overlay.module.css";

/** How long the hide ack waits for an animation frame before answering anyway. */
export const HIDDEN_ACK_FALLBACK_MS = 50;

/** How long `beforeSend` (persisting the Frame) may take before the answer goes out anyway. */
export const BEFORE_SEND_TIMEOUT_MS = 300;

/** Settles when `work` does, or after `ms`; a rejection is swallowed (it is a convenience). */
async function bestEffort(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([work.catch(() => {}), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The slice of the preload bridge the overlay uses; tests pass a fake. */
export type CaptureOverlayApi = Pick<
  KaipuElectronAPI,
  "captureOverlay" | "getSettings" | "updateSettings"
>;

/**
 * Send `answer` once. `beforeSend` (the Frame box persisting its geometry) runs first,
 * but a failure or a hang there (it is cut off after `BEFORE_SEND_TIMEOUT_MS`) never blocks
 * the answer, or the user would be stuck under the sheet. While it runs nothing has been
 * answered yet, so Esc still cancels at once.
 */
export type SendAnswer = (answer: OverlayAnswer, beforeSend?: () => Promise<void>) => void;

interface CaptureOverlayProps {
  query: OverlayQuery;
  api?: CaptureOverlayApi;
  /** Which key copies (⌘C or Ctrl+C); detected from the browser when omitted. */
  platform?: KeyPlatform;
}

/**
 * The renderer side of one capture overlay window (`?window=capture-overlay`): a
 * full-window dim sheet with the Frame box, the Window picker or the Screen card on top,
 * in whichever mode main's state says (the initial one comes from the query). It only
 * answers "this rectangle / this window / this display" with an action, or "cancelled";
 * main captures the pixels.
 *
 * Keys: 1–3 switch the mode (here at once, and on every other overlay through main), Esc
 * anywhere cancels; Enter and ⌘C / Ctrl+C belong to each mode's UI. Only the first answer
 * is sent: a second Esc, or Enter after a click, does nothing (main also keeps only the
 * first, across every display). Main also cancels on Esc itself, so this renderer-side
 * handler is not the only way out.
 */
export function CaptureOverlay({
  query,
  api = window.electronAPI,
  platform: platformProp,
}: CaptureOverlayProps): React.JSX.Element | null {
  const bridge = api.captureOverlay;
  const platform = useMemo(() => platformProp ?? detectKeyPlatform(), [platformProp]);
  const answered = useRef(false);
  const persisting = useRef(false);
  // Seeded from the URL query so the first paint is right; main's broadcast keeps it live.
  const [state, setState] = useState<OverlayState>(() => ({
    mode: query.ui,
    hoverDisplayId: null,
    frameDisplayId: query.frame,
    windows: null,
  }));
  const mode = state.mode;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => bridge.onState(setState), [bridge]);

  const send = useCallback<SendAnswer>(
    (answer, beforeSend) => {
      if (answered.current) return;
      if (!beforeSend) {
        answered.current = true;
        bridge.answer(answer);
        return;
      }
      // A second confirm while the first is persisting is ignored; Esc is not.
      if (persisting.current) return;
      persisting.current = true;
      void (async () => {
        await bestEffort(beforeSend(), BEFORE_SEND_TIMEOUT_MS);
        // Esc got in while the frame was being remembered: that cancel already went out.
        if (answered.current) return;
        answered.current = true;
        bridge.answer(answer);
      })();
    },
    [bridge],
  );

  const cancel = useCallback(() => send({ kind: "cancelled" }), [send]);

  /**
   * Re-render in `next` at once and tell main, which switches every other overlay. Entering
   * Frame puts the frame here until main says otherwise, as main does for the asking display.
   */
  const switchMode = useCallback(
    (next: CaptureMode) => {
      if (answered.current || persisting.current || next === modeRef.current) return;
      modeRef.current = next;
      setState((current) => ({
        ...current,
        mode: next,
        frameDisplayId: next === "frame" ? query.displayId : null,
      }));
      bridge.setMode(next);
    },
    [bridge, query.displayId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      const next = modeForKey(event);
      if (!next) return;
      event.preventDefault();
      switchMode(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, switchMode]);

  // Main hid the window and waits until this renderer has drawn one more frame, so its
  // last painted frame cannot end up in the shot. A hidden window may never run its
  // animation frames, so a short timer races the frame; main's 250 ms cap stays the
  // safety net behind both.
  useEffect(
    () =>
      bridge.onHiddenAckRequest(() => {
        let sent = false;
        let frame = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ack = (): void => {
          if (sent) return;
          sent = true;
          clearTimeout(timer);
          cancelAnimationFrame(frame);
          bridge.hiddenAck();
        };
        frame = requestAnimationFrame(ack);
        timer = setTimeout(ack, HIDDEN_ACK_FALLBACK_MS);
      }),
    [bridge],
  );

  const chrome = useMemo<OverlayChrome>(
    () => ({ mode, platform, onMode: switchMode, onCancel: cancel }),
    [mode, platform, switchMode, cancel],
  );

  const body =
    mode === "screen" ? (
      <ScreenCard
        query={query}
        bridge={bridge}
        hoverDisplayId={state.hoverDisplayId}
        chrome={chrome}
        send={send}
      />
    ) : mode === "window" ? (
      <WindowPicker query={query} windows={state.windows} chrome={chrome} send={send} />
    ) : (
      <FrameMode
        query={query}
        api={api}
        frameDisplayId={state.frameDisplayId}
        chrome={chrome}
        send={send}
      />
    );
  return (
    <>
      {body}
      <HintPill mode={mode} platform={platform} />
      <DisplayLabel index={query.index} />
    </>
  );
}

/** The key hint at the bottom of every overlay. */
function HintPill({
  mode,
  platform,
}: {
  mode: CaptureMode;
  platform: KeyPlatform;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const copyKey = copyKeyLabel(platform);
  return (
    <span className={styles.hintPill} data-testid="hint-pill">
      {mode === "frame" ? t("overlay.hintFrame", { copyKey }) : t("overlay.hintPick", { copyKey })}
    </span>
  );
}

/** "DISPLAY N" in the bottom-left corner of every overlay, so each display says which it is. */
function DisplayLabel({ index }: { index: number }): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <span className={styles.displayLabel} aria-hidden>
      {t("overlay.displayLabel", { index })}
    </span>
  );
}

/**
 * Frame mode with several displays: exactly one overlay (main's `frameDisplayId`) shows the
 * Frame box; every other one offers "Click to move the frame here". Until the query or main's first
 * state names it, nothing but the dim sheet shows, so a frame never flashes on the wrong display.
 */
function FrameMode({
  query,
  api,
  frameDisplayId,
  chrome,
  send,
}: {
  query: OverlayQuery;
  api: CaptureOverlayApi;
  frameDisplayId: number | null;
  chrome: OverlayChrome;
  send: SendAnswer;
}): React.JSX.Element {
  const bridge = api.captureOverlay;

  if (frameDisplayId === null) {
    return <div className={styles.sheet} />;
  }
  if (frameDisplayId !== query.displayId) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={`${styles.sheet} ${styles.chooser}`}
        onClick={() => bridge.chooseFrameDisplay(query.displayId)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          bridge.chooseFrameDisplay(query.displayId);
        }}
      >
        <MoveFrameHint />
      </div>
    );
  }
  return <ActiveFrame query={query} api={api} chrome={chrome} send={send} />;
}

function MoveFrameHint(): React.JSX.Element {
  const t = useTranslations("screenshots");
  return <span className={styles.movePill}>{t("overlay.moveFrameHere")}</span>;
}

/**
 * The display that holds the frame: load its remembered geometry, persist it on confirm.
 * Mounting is what loads it; unmounting (the frame moved away) persists nothing.
 */
function ActiveFrame({
  query,
  api,
  chrome,
  send,
}: {
  query: OverlayQuery;
  api: CaptureOverlayApi;
  chrome: OverlayChrome;
  send: SendAnswer;
}): React.JSX.Element {
  const key = String(query.displayId);
  // undefined while loading; null when nothing is remembered (or settings failed).
  const [remembered, setRemembered] = useState<CaptureRect | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api
      .getSettings()
      .then((settings) => {
        if (live) setRemembered(settings.screenshotFrame?.[key] ?? null);
      })
      .catch(() => {
        if (live) setRemembered(null);
      });
    return () => {
      live = false;
    };
  }, [api, key]);

  const confirm = useCallback(
    (rect: CaptureRect, action: CaptureAction) => {
      send({ kind: "rect", mode: "frame", action, displayId: query.displayId, rect }, async () => {
        // Re-read so another display's remembered frame is kept, not overwritten.
        const current = await api.getSettings();
        await api.updateSettings({
          screenshotFrame: { ...current.screenshotFrame, [key]: rect },
        });
      });
    },
    [api, key, query.displayId, send],
  );

  // The dim sheet shows while the settings load (a few ms), so the window never flashes.
  if (remembered === undefined) return <div className={styles.sheet} />;
  return <FrameBox query={query} remembered={remembered} chrome={chrome} onConfirm={confirm} />;
}
