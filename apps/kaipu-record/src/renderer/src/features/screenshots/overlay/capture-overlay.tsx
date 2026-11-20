import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import {
  ENABLED_CAPTURE_MODES,
  isRecordAction,
  type CaptureAction,
  type CaptureRect,
  type CaptureIntent,
  type CaptureMode,
  type OverlayAnswer,
  type OverlayState,
  type RecordingRatio,
  type TaggedOverlayAnswer,
  type RememberedArea,
} from "@shared/types/screenshot-capture";
import { useTranslations } from "@kaipu/i18n";
import { sanitizeCountdownSeconds } from "@shared/types/ipc";
import { FrameBox } from "./frame-box";
import {
  createControlTap,
  detectKeyPlatform,
  intentForKey,
  modeForKey,
  toggleForKey,
  type InputToggleKey,
  type KeyPlatform,
} from "./overlay-keys";
import type { InputToast, OverlayChrome } from "./overlay-chrome";
import type { OverlayQuery } from "./overlay-query";
import { ScreenCard } from "./screen-card";
import { TOAST_MS } from "./capture-widget";
import { loadSettings } from "@renderer/features/settings/settings-store";
import { useOverlayToggles } from "./use-overlay-toggles";
import { useWidgetDevices } from "./use-widget-devices";
import { useWidgetExpanded } from "./use-widget-expanded";
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

/** `answer`, marked with the pick it answers when main said which (absent from older senders). */
function tagged(answer: OverlayAnswer, session: number | undefined): TaggedOverlayAnswer {
  return session === undefined ? answer : { ...answer, session };
}

/** The slice of the preload bridge the overlay uses; tests pass a fake. */
export type CaptureOverlayApi = Pick<
  KaipuElectronAPI,
  | "captureOverlay"
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
  /**
   * The state main's first message of this pick carried (`CaptureOverlayHost` read it): the
   * overlay paints it at once instead of waiting for the state request to be answered.
   */
  initialState?: OverlayState;
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
 * Keys: 1..n (one per enabled mode) switch the mode (here at once, and on every other overlay
 * through main), Esc cancels; Enter and ⌘C / Ctrl+C belong to each mode's UI. While the
 * countdown runs here, Esc and Cancel stop only the count (main's own Esc yields through
 * `setCounting`) and a second one cancels. Only the first answer is sent: a second Esc, or
 * Enter after a click, does nothing (main also keeps only the first, across every display).
 * Main also cancels on Esc itself when no count runs, so this renderer-side handler is not the
 * only way out.
 */
export function CaptureOverlay({
  query: loadedQuery,
  initialState,
  api = window.electronAPI,
  platform: platformProp,
  enabledModes = ENABLED_CAPTURE_MODES,
}: CaptureOverlayProps): React.JSX.Element | null {
  const bridge = api.captureOverlay;
  // A window loaded ahead of its pick (`spare=1`) paints nothing until main's first state
  // arrives; that state also says which intent it opened for.
  const [received, setReceived] = useState(!loadedQuery.spare || initialState !== undefined);
  const [openedIntent, setOpenedIntent] = useState<CaptureIntent | null>(() => {
    if (!loadedQuery.spare) return loadedQuery.intent;
    return initialState ? (initialState.intent ?? "capture") : null;
  });
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
  const [state, setState] = useState<OverlayState>(
    () =>
      initialState ?? {
        mode: query.ui,
        hoverDisplayId: null,
        frameDisplayId: query.frame,
        windows: null,
      },
  );
  // The pick this state belongs to; the answer carries it (see `TaggedOverlayAnswer`).
  const sessionRef = useRef(state.session);
  sessionRef.current = state.session;
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
        // Another overlay changed the mode: a held Record answers for the old one.
        if (incoming.mode !== modeRef.current) heldRequest.current = null;
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
        bridge.answer(tagged(answer, sessionRef.current));
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
        bridge.answer(tagged(answer, sessionRef.current));
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
      // A Record held for the settings read answers for the old mode; replayed, it would
      // record what is no longer on screen.
      heldRequest.current = null;
      setState((current) => ({
        ...current,
        mode: next,
        frameDisplayId: next === "frame" ? query.displayId : null,
      }));
      bridge.setMode(next);
    },
    [bridge, query.displayId],
  );

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
  const devices = useWidgetDevices(api, recording);
  // Compact or expanded, remembered for screenshots and recordings apart.
  const { expanded: widgetExpanded, toggle: toggleWidgetExpanded } = useWidgetExpanded(api, intent);

  // The configured countdown, read when the overlay is (or becomes) a recording one. Until
  // that read settles (a value or the fallback after a failure) the length is unknown, so a
  // Record pressed in that window is held and replayed once it is known; counting the
  // fallback then would hand `countdownDone: true` to a recorder that owes a longer count.
  const [countdownSeconds, setCountdownSeconds] = useState<number>(() =>
    sanitizeCountdownSeconds(undefined),
  );
  // The same length for `request`, which must see it the moment the read settles.
  const countdownLength = useRef(countdownSeconds);
  const countdownRead = useRef(false);
  const heldRequest = useRef<Parameters<SendAnswer> | null>(null);
  const requestRef = useRef<SendAnswer | null>(null);
  useEffect(() => {
    if (!recording) return;
    let live = true;
    const settle = (seconds: number | undefined): void => {
      if (!live) return;
      const length = sanitizeCountdownSeconds(seconds);
      countdownLength.current = length;
      countdownRead.current = true;
      setCountdownSeconds(length);
      const held = heldRequest.current;
      heldRequest.current = null;
      if (held) requestRef.current?.(...held);
    };
    loadSettings()
      .then((settings) => settle(settings.recordingCountdownSeconds))
      .catch(() => settle(undefined));
    return () => {
      live = false;
      heldRequest.current = null;
    };
  }, [api, recording]);

  // The countdown runs here, in the widget (ADR 0056), and the record answer carries
  // `countdownDone`, so neither main nor the recorder counts a second time.
  const [countdown, setCountdown] = useState<number | null>(null);
  const counting = useRef(false);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const endCountdown = useCallback(() => {
    clearInterval(countdownTimer.current);
    countdownTimer.current = undefined;
    if (!counting.current) return;
    counting.current = false;
    setCountdown(null);
    bridge.setCounting(false);
  }, [bridge]);
  // Leaving mid-count (the window closed) must not leave a timer ticking.
  useEffect(() => () => clearInterval(countdownTimer.current), []);

  const request = useCallback<SendAnswer>(
    (answer, beforeSend) => {
      const records =
        (answer.kind === "rect" || answer.kind === "display") && isRecordAction(answer.action);
      if (records && !countdownRead.current) {
        // The length is not known yet: hold the latest Record and replay it when it is.
        if (!answered.current && !persisting.current) heldRequest.current = [answer, beforeSend];
        return;
      }
      if (!records || countdownLength.current <= 0) {
        send(answer, beforeSend);
        return;
      }
      // A second confirm during the count, or after the answer, does nothing.
      if (counting.current || answered.current || persisting.current) return;
      counting.current = true;
      let remaining = countdownLength.current;
      setCountdown(remaining);
      bridge.setCounting(true);
      countdownTimer.current = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          setCountdown(remaining);
          return;
        }
        endCountdown();
        send({ ...answer, countdownDone: true }, beforeSend);
      }, 1000);
    },
    [bridge, endCountdown, send],
  );
  requestRef.current = request;

  // Esc and the Cancel button end the countdown first; a second one cancels the overlay.
  const cancelOrStopCount = useCallback(() => {
    if (counting.current) {
      endCountdown();
      return;
    }
    cancel();
  }, [cancel, endCountdown]);

  const [toast, setToast] = useState<InputToast | null>(null);
  const toastId = useRef(0);
  const showToast = useCallback((input: InputToggleKey, on: boolean) => {
    toastId.current += 1;
    setToast({ id: toastId.current, input, on });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const moreSettings = useCallback(() => {
    if (answered.current) return;
    answered.current = true;
    endCountdown();
    bridge.openRecordSettings();
  }, [bridge, endCountdown]);

  const chrome = useMemo<OverlayChrome>(
    () => ({
      mode,
      modes: enabledModes,
      platform,
      intent,
      onMode: switchMode,
      onCancel: cancelOrStopCount,
      onIntent: setIntent,
      ...(recording ? { toggles, devices } : {}),
      toast,
      countdown,
      countdownSeconds,
      expanded: widgetExpanded,
      onToggleExpanded: toggleWidgetExpanded,
      onMoreSettings: moreSettings,
    }),
    [
      mode,
      enabledModes,
      platform,
      intent,
      switchMode,
      cancelOrStopCount,
      recording,
      toggles,
      devices,
      setIntent,
      toast,
      countdown,
      countdownSeconds,
      widgetExpanded,
      toggleWidgetExpanded,
      moreSettings,
    ],
  );

  // Control pressed and released alone flips the toolbar between compact and expanded. Not
  // while the countdown runs (the widget is committed) or after the answer went out.
  const controlTap = useMemo(
    () =>
      createControlTap(() => {
        if (answered.current || counting.current) return;
        toggleWidgetExpanded();
      }),
    [toggleWidgetExpanded],
  );

  // Layout effect: Esc, the mode keys and the Control tap work from the first paint (see
  // FrameBox, and NIW2-557: a passive effect attaches one task after the commit, and a key
  // pressed the moment the widget is in the DOM would be lost).
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      controlTap.keyDown(event);
      if (event.key === "Escape") {
        event.preventDefault();
        cancelOrStopCount();
        return;
      }
      // While the countdown runs the widget is committed: only Esc and Cancel act.
      if (counting.current) return;
      const nextIntent = intentForKey(event);
      if (nextIntent) {
        event.preventDefault();
        if (!answered.current) setIntent(nextIntent);
        return;
      }
      const input = toggleForKey(event, intent);
      if (input) {
        event.preventDefault();
        if (answered.current) return;
        const became = toggles.toggle(input);
        if (became !== null) showToast(input, became);
        return;
      }
      const next = modeForKey(event, enabledModes);
      if (!next) return;
      event.preventDefault();
      switchMode(next);
    };
    const onKeyUp = (event: KeyboardEvent): void => controlTap.keyUp(event);
    // A Ctrl+click is not a tap, and a window that lost focus never hears the release.
    const onPointerDown = (): void => controlTap.cancel();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onPointerDown);
    };
  }, [
    cancelOrStopCount,
    switchMode,
    enabledModes,
    setIntent,
    intent,
    toggles,
    showToast,
    controlTap,
  ]);

  if (!received) return null;

  const body =
    mode === "screen" ? (
      <ScreenCard
        query={query}
        bridge={bridge}
        hoverDisplayId={state.hoverDisplayId}
        chrome={chrome}
        send={request}
      />
    ) : mode === "window" && enabledModes.includes("window") ? (
      <WindowPicker
        query={query}
        bridge={bridge}
        windows={state.windows}
        hoverDisplayId={state.hoverDisplayId}
        cursor={state.cursor ?? null}
        chrome={chrome}
        send={request}
      />
    ) : (
      <FrameMode
        query={query}
        api={api}
        frameDisplayId={state.frameDisplayId}
        chrome={chrome}
        send={request}
        session={state.session}
      />
    );
  return (
    <>
      {body}
      <DisplayLabel index={query.index} />
    </>
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
  session,
}: {
  query: OverlayQuery;
  api: CaptureOverlayApi;
  frameDisplayId: number | null;
  chrome: OverlayChrome;
  send: SendAnswer;
  session: number | undefined;
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
  return <ActiveFrame query={query} api={api} chrome={chrome} send={send} session={session} />;
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
  session,
}: {
  query: OverlayQuery;
  api: CaptureOverlayApi;
  chrome: OverlayChrome;
  send: SendAnswer;
  session: number | undefined;
}): React.JSX.Element {
  const key = String(query.displayId);
  // A recording area and a screenshot frame are remembered apart (ADR 0030): the overlay
  // opened to record starts from the last recording area.
  const memory = query.intent === "record" ? "recordingArea" : "screenshotFrame";
  // undefined while loading; null when nothing is remembered (or settings failed).
  const [remembered, setRemembered] = useState<RememberedArea | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadSettings()
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

  // Reported, never saved here: main keeps the latest and writes it once if the pick closes.
  const settled = useCallback(
    (rect: CaptureRect, ratio?: RecordingRatio, confirming?: true) => {
      api.captureOverlay.reportFrame({
        displayId: query.displayId,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        ...(ratio ? { ratio } : {}),
        ...(session === undefined ? {} : { session }),
        ...(confirming ? { confirming } : {}),
      });
    },
    [api, query.displayId, session],
  );

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
          // Main saves nothing for a close (Esc) that lands during this write.
          settled(plain, ratio, true);
          // The window's copy, which main's broadcast keeps current, carries the other displays'
          // rectangles, so they are kept; a save from another display in the same few ms could be lost.
          // The display it was confirmed on is the one this intent reopens on (NIW2-878); one
          // patch, so confirming is still one settings write.
          const current = await loadSettings();
          await api.updateSettings({
            [into]: { ...current[into], [key]: stored },
            lastFrameDisplay: {
              ...current.lastFrameDisplay,
              [isRecordAction(action) ? "record" : "capture"]: query.displayId,
            },
          });
        },
      );
    },
    [api, key, query.displayId, send, settled],
  );

  // The dim sheet shows while the settings load (a few ms), so the window never flashes.
  if (remembered === undefined) return <div className={styles.sheet} />;
  return (
    <FrameBox
      query={query}
      remembered={remembered}
      chrome={chrome}
      onConfirm={confirm}
      onSettled={settled}
    />
  );
}
