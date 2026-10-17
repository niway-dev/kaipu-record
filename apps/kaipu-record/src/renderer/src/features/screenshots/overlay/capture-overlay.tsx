import { useCallback, useEffect, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { CaptureRect, OverlayAnswer } from "@shared/types/screenshot-capture";
import { AreaDrag } from "./area-drag";
import { FrameBox } from "./frame-box";
import type { OverlayQuery } from "./overlay-query";
import { ScreenChooser } from "./screen-chooser";
import styles from "./capture-overlay.module.css";

/** How long the hide ack waits for an animation frame before answering anyway. */
export const HIDDEN_ACK_FALLBACK_MS = 50;

/** The slice of the preload bridge the overlay uses; tests pass a fake. */
export type CaptureOverlayApi = Pick<
  KaipuElectronAPI,
  "captureOverlay" | "getSettings" | "updateSettings"
>;

/**
 * Send `answer` once. `beforeSend` (the Frame box persisting its geometry) runs first;
 * a failure there never blocks the answer, or the user would be stuck under the sheet.
 */
export type SendAnswer = (answer: OverlayAnswer, beforeSend?: () => Promise<void>) => void;

interface CaptureOverlayProps {
  query: OverlayQuery;
  api?: CaptureOverlayApi;
}

/**
 * The renderer side of one capture overlay window (`?window=capture-overlay`): a
 * full-window dim sheet with the Area drag, Screen chooser or Frame box on top. It only
 * answers "this rectangle / this display" or "cancelled"; main captures the pixels.
 *
 * Esc anywhere cancels. Only the first answer is sent: a second Esc, or Enter after a
 * click, does nothing (main also keeps only the first, across every display).
 */
export function CaptureOverlay({
  query,
  api = window.electronAPI,
}: CaptureOverlayProps): React.JSX.Element | null {
  const bridge = api.captureOverlay;
  const answered = useRef(false);

  const send = useCallback<SendAnswer>(
    (answer, beforeSend) => {
      if (answered.current) return;
      answered.current = true;
      void (async () => {
        if (beforeSend) {
          try {
            await beforeSend();
          } catch {
            // Remembering the frame is a convenience; the capture still goes ahead.
          }
        }
        bridge.answer(answer);
      })();
    },
    [bridge],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      send({ kind: "cancelled" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send]);

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

  if (query.ui === "screen") return <ScreenChooser query={query} bridge={bridge} send={send} />;
  if (query.ui === "area") return <AreaDrag query={query} send={send} />;
  return <FrameMode query={query} api={api} send={send} />;
}

/** Frame mode: load the remembered frame for this display, persist it on confirm. */
function FrameMode({
  query,
  api,
  send,
}: {
  query: OverlayQuery;
  api: CaptureOverlayApi;
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
    (rect: CaptureRect) => {
      send({ kind: "rect", displayId: query.displayId, rect }, async () => {
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
  return <FrameBox query={query} remembered={remembered} onConfirm={confirm} />;
}
