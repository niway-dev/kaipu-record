import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import {
  ENABLED_CAPTURE_MODES,
  isRecordAction,
  type CaptureAction,
  type CaptureIntent,
  type CaptureMode,
  type OverlayAnswer,
  type OverlayState,
  type RecordingRatio,
  type RememberedArea,
} from "@shared/types/screenshot-capture";
import { useTranslations } from "@kaipu/i18n";
import { FrameBox } from "./frame-box";
import {
  copyKeyLabel,
  detectKeyPlatform,
  intentForKey,
  modeForKey,
  type KeyPlatform,
} from "./overlay-keys";
import type { OverlayQuery } from "./overlay-query";
import { useOverlayToggles } from "./record-chrome";
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
  | "captureOverlay"
  | "getSettings"
  | "updateSettings"
  | "getRecordingSettings"
  | "updateRecordingSettings"
  | "onRecordingSettingsChanged"
> &
  // Optional: a fake without it reads camera access as "unknown" (togglable).
  Partial<Pick<KaipuElectronAPI, "getCameraAccessStatus">>;

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
  /** The modes on offer; defaults to `ENABLED_CAPTURE_MODES` (Window is off). */
  enabledModes?: readonly CaptureMode[];
}

/**
 * The renderer side of one capture overlay window (`?window=capture-overlay`): a
 * full-window dim sheet with the Frame box, the Window picker or the Screen card on top,
 * in whichever mode main's state says (the initial one comes from the query). It only
 * answers "this rectangle / this window / this display" with an action, or "cancelled";
 * main captures the pixels.
 *
 * Keys: 1..n (one per enabled mode) switch the mode (here at once, and on every other overlay through main), Esc
 * anywhere cancels; Enter and ⌘C / Ctrl+C belong to each mode's UI. Only the first answer
 * is sent: a second Esc, or Enter after a click, does nothing (main also keeps only the
 * first, across every display). Main also cancels on Esc itself, so this renderer-side
 * handler is not the only way out.
 */
export function CaptureOverlay({
  query: loadedQuery,
  api = window.electronAPI,
  platform: platformProp,
  enabledModes = ENABLED_CAPTURE_MODES,
}: CaptureOverlayProps): React.JSX.Element | null {
  const bridge = api.captureOverlay;
  // A window loaded ahead of its pick (`spare=1`) paints nothing until main's first state
  // arrives; that state also says which intent it opened for.
  const [received, setReceived] = useState(!loadedQuery.spare);
  const [openedIntent, setOpenedIntent] = useState<CaptureIntent | null>(
    loadedQuery.spare ? null : loadedQuery.intent,
  );
  // What the children read: the loaded query, with the intent the pick opened for.
  const query = useMemo<OverlayQuery>(
    () => ({ ...loadedQuery, intent: openedIntent ?? loadedQuery.intent }),
    [loadedQuery, openedIntent],
  );
  const platform = useMemo(() => platformProp ?? detectKeyPlatform(), [platformProp]);
  const answered = useRef(false);
  // Opened to capture or to record (the URL), then switched in place with P / V or the
  // Capture | Record switch. Only the confirm actions follow it; the selection stays.
  const [intent, setLocalIntent] = useState<CaptureIntent>(query.intent);
  /** Like `requestedMode`: the intent this overlay asked main for, not confirmed yet. */
  const requestedIntent = useRef<CaptureIntent | null>(null);
  // Switch here at once and tell main, which switches every other overlay.
  const setIntent = useCallback(
    (next: CaptureIntent) => {
      setLocalIntent(next);
      requestedIntent.current = next;
      bridge.setIntent(next);
    },
    [bridge],
  );
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
  /**
   * The mode this overlay asked main for and main has not confirmed yet. A broadcast main
   * sent before it saw the switch (a hover, the window list) still carries the old mode;
   * applied as-is it would flip the UI back for a frame. Until a broadcast names the
   * requested mode, the local one stays authoritative and the rest of the state applies.
   */
  const requestedMode = useRef<CaptureMode | null>(null);

  useEffect(() => {
    const unsubscribe = bridge.onState((incoming) => {
      setReceived(true);
      setOpenedIntent((opened) => opened ?? incoming.intent ?? "capture");
      if (incoming.intent !== undefined) {
        const asked = requestedIntent.current;
        if (asked === null || incoming.intent === asked) {
          requestedIntent.current = null;
          setLocalIntent(incoming.intent);
        }
      }
      const requested = requestedMode.current;
      if (requested === null || incoming.mode === requested) {
        requestedMode.current = null;
        setState(incoming);
        return;
      }
      setState((current) => ({
        ...incoming,
        mode: current.mode,
        frameDisplayId: current.frameDisplayId,
      }));
    });
    // Main may have sent the first state before this listener existed (a spare that was still
    // loading when its pick opened); without it a spare paints nothing and the screen-sized
    // window swallows every click. Ask again now that it is heard.
    bridge.requestState();
    return unsubscribe;
  }, [bridge]);

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
      requestedMode.current = next;
      setState((current) => ({
        ...current,
        mode: next,
        frameDisplayId: next === "frame" ? query.displayId : null,
      }));
      bridge.setMode(next);
    },
    [bridge, query.displayId],
  );

  // Layout effect: Esc and the mode keys work from the first paint (see FrameBox).
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      const nextIntent = intentForKey(event);
      if (nextIntent) {
        event.preventDefault();
        if (!answered.current) setIntent(nextIntent);
        return;
      }
      const next = modeForKey(event, enabledModes);
      if (!next) return;
      event.preventDefault();
      switchMode(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, switchMode, enabledModes, setIntent]);

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

  // Mic, System audio and Camera live on the overlay only when it opened to record.
  const recording = intent === "record";
  const toggles = useOverlayToggles(api, recording);
  const chrome = useMemo<OverlayChrome>(
    () => ({
      mode,
      modes: enabledModes,
      platform,
      intent,
      onMode: switchMode,
      onCancel: cancel,
      onIntent: setIntent,
      ...(recording ? { toggles } : {}),
    }),
    [mode, enabledModes, platform, intent, switchMode, cancel, recording, toggles, setIntent],
  );

  if (!received) return null;

  const body =
    mode === "screen" ? (
      <ScreenCard
        query={query}
        bridge={bridge}
        hoverDisplayId={state.hoverDisplayId}
        chrome={chrome}
        send={send}
      />
    ) : mode === "window" && enabledModes.includes("window") ? (
      <WindowPicker
        query={query}
        bridge={bridge}
        windows={state.windows}
        hoverDisplayId={state.hoverDisplayId}
        cursor={state.cursor ?? null}
        chrome={chrome}
        send={send}
      />
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
      <HintPill mode={mode} platform={platform} modeCount={enabledModes.length} intent={intent} />
      <DisplayLabel index={query.index} />
    </>
  );
}

/** The key hint at the bottom of every overlay. */
function HintPill({
  mode,
  platform,
  modeCount,
  intent,
}: {
  mode: CaptureMode;
  platform: KeyPlatform;
  modeCount: number;
  intent: CaptureIntent;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const copyKey = copyKeyLabel(platform);
  const keys = `1–${modeCount}`;
  const text =
    intent === "record"
      ? mode === "frame"
        ? t("overlay.hintFrameRecord", { keys })
        : t("overlay.hintPickRecord")
      : mode === "frame"
        ? t("overlay.hintFrame", { copyKey, keys })
        : t("overlay.hintPick", { copyKey, keys });
  return (
    <span className={styles.hintPill} data-testid="hint-pill">
      {text}
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
  // A recording area and a screenshot frame are remembered apart (ADR 0030): the overlay
  // opened to record starts from the last recording area.
  const memory = query.intent === "record" ? "recordingArea" : "screenshotFrame";
  // undefined while loading; null when nothing is remembered (or settings failed).
  const [remembered, setRemembered] = useState<RememberedArea | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api
      .getSettings()
      .then((settings) => {
        if (live) setRemembered(settings[memory]?.[key] ?? null);
      })
      .catch(() => {
        if (live) setRemembered(null);
      });
    return () => {
      live = false;
    };
  }, [api, key, memory]);

  const confirm = useCallback(
    (rect: RememberedArea, action: CaptureAction, ratio?: RecordingRatio) => {
      // Remembered by what it became: a rectangle that was recorded is the next recording
      // area, whichever intent opened the overlay; one that was shot is the next frame.
      const into = isRecordAction(action) ? "recordingArea" : "screenshotFrame";
      // A recording area keeps the ratio it was drawn with; the answer carries the rectangle only.
      const { x, y, width, height } = rect;
      const plain = { x, y, width, height };
      const stored = into === "recordingArea" && ratio ? { ...plain, ratio } : plain;
      // The answer carries it too, so main can store the take's ratio without waiting for
      // the settings write below (it lands after the answer).
      const withRatio = into === "recordingArea" && ratio ? { ratio } : {};
      send(
        {
          kind: "rect",
          mode: "frame",
          action,
          displayId: query.displayId,
          rect: plain,
          ...withRatio,
        },
        async () => {
          // Re-read so another display's remembered rectangle is kept, not overwritten.
          const current = await api.getSettings();
          await api.updateSettings({ [into]: { ...current[into], [key]: stored } });
        },
      );
    },
    [api, key, query.displayId, send],
  );

  // The dim sheet shows while the settings load (a few ms), so the window never flashes.
  if (remembered === undefined) return <div className={styles.sheet} />;
  return <FrameBox query={query} remembered={remembered} chrome={chrome} onConfirm={confirm} />;
}
