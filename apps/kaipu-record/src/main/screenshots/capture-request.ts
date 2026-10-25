/**
 * What a capture shortcut (⌘⌃X, the panel's "Capture Screen") does when asked to capture.
 *
 * During a recording the main window is hidden, so the renderer's own guard
 * ("finish the recording first") would toast into an invisible window. Main
 * knows the recording is active, so it refuses here and tells the user with a
 * system notification instead. Outside a recording it forwards the request to
 * the renderer, which keeps its own guard for the countdown phase (the hub is
 * not active yet, but the window is still visible).
 */
export interface CaptureRequestDeps {
  isRecordingActive: () => boolean;
  notifyBusy: () => void;
  forwardToRenderer: () => void;
}

export function routeCaptureRequest(deps: CaptureRequestDeps): void {
  if (deps.isRecordingActive()) {
    deps.notifyBusy();
    return;
  }
  deps.forwardToRenderer();
}
