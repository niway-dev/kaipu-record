import type { CaptureToastPayload } from "@shared/types/screenshot-capture";
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
 * The display is the one this capture's own pick answered on, handed in with the payload
 * (not read from shared state: the next pick may answer before this toast is shown); a
 * capture that opened no overlay (the instant capture) uses `fallbackDisplayId`.
 */
export function deferToastUntilAfterCapture(
  windows: CaptureWindowHooks,
  showToast: (request: CaptureToastShowRequest) => void,
  fallbackDisplayId: () => number,
): {
  windows: CaptureWindowHooks;
  onQuietCapture(payload: CaptureToastPayload, displayId: number | null): void;
} {
  let pending: { payload: CaptureToastPayload; displayId: number | null } | null = null;

  const flush = (): void => {
    const held = pending;
    pending = null;
    if (!held) return;
    try {
      showToast({ ...held.payload, displayId: held.displayId ?? fallbackDisplayId() });
    } catch (error) {
      // A broken toast must never turn a finished capture into an error.
      console.error("screenshot capture toast failed", error);
    }
  };

  return {
    windows: {
      beforeCapture: () => {
        pending = null;
        windows.beforeCapture();
      },
      afterCapture: (ending) => {
        try {
          windows.afterCapture(ending);
        } finally {
          flush();
        }
      },
      reveal: () => windows.reveal(),
    },
    onQuietCapture: (payload, displayId) => {
      pending = { payload, displayId };
    },
  };
}
