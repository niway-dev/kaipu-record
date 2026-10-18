import type { CaptureToastPayload, OverlayAnswer } from "@shared/types/screenshot-capture";
import type { CaptureWindowHooks } from "./capture-handler";
import type { CaptureToastShowRequest } from "./capture-toast-window";

/**
 * Glue between the capture handler's `onQuietCapture` seam and the toast window.
 *
 * The handler reports a quiet capture before its `finally` runs `afterCapture`, so the
 * toast is held until the windows are back where they were (spec open question 4): the
 * toast is then the last window to appear and nothing restored afterwards covers it.
 * `beforeCapture` only hides the main window (`BrowserWindow.hide()`, not `app.hide()`),
 * so the app itself is never hidden and the toast can show while that window stays hidden.
 *
 * The display comes from the overlay's answer; a capture that opened no overlay
 * (Screen on a single display) uses `fallbackDisplayId`.
 */
export function deferToastUntilAfterCapture(
  windows: CaptureWindowHooks,
  showToast: (request: CaptureToastShowRequest) => void,
  fallbackDisplayId: () => number,
): {
  windows: CaptureWindowHooks;
  onQuietCapture(payload: CaptureToastPayload): void;
  onPick(answer: OverlayAnswer): void;
} {
  let pending: CaptureToastPayload | null = null;
  let pickedDisplayId: number | null = null;

  const flush = (): void => {
    const payload = pending;
    pending = null;
    if (!payload) return;
    try {
      showToast({ ...payload, displayId: pickedDisplayId ?? fallbackDisplayId() });
    } catch (error) {
      // A broken toast must never turn a finished capture into an error.
      console.error("screenshot capture toast failed", error);
    }
  };

  return {
    windows: {
      beforeCapture: () => {
        pending = null;
        pickedDisplayId = null;
        windows.beforeCapture();
      },
      afterCapture: (editorTakesOver) => {
        try {
          windows.afterCapture(editorTakesOver);
        } finally {
          flush();
        }
      },
      reveal: () => windows.reveal(),
    },
    onQuietCapture: (payload) => {
      pending = payload;
    },
    onPick: (answer) => {
      pickedDisplayId = answer.kind === "cancelled" ? null : answer.displayId;
    },
  };
}
