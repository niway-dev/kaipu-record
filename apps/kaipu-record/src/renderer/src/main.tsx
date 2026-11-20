import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/app";
import { CapturePanel } from "./features/capture-panel/capture-panel";
import { ControlBarWindowRoot } from "./features/control-bar/control-bar-window";
import { CameraBubble } from "./features/camera-bubble/camera-bubble";
import { CaptureOverlayHost } from "./features/screenshots/overlay/capture-overlay-host";
import { parseOverlayQuery } from "./features/screenshots/overlay/overlay-query";
import { CaptureToast } from "./features/screenshots/toast/capture-toast";
import { RecordingReadyCard } from "./features/recording-ready/recording-ready-card";
import { RecordingShade } from "./features/recording-shade/recording-shade";
import { installCrashForwarder } from "./features/analytics/crash-forwarder";
import { I18nRoot } from "./app/i18n-root";
import { StylexProbe } from "./dev/stylex-probe";
import { windowKindFromSearch } from "./window-kind";
import type { WindowKind } from "@shared/ui-map";

// Same HTML entry, eight render targets (the window kinds in `@shared/ui-map`, plus the app):
//   ?mode=capture           → the menu-bar tray's compact panel
//   ?window=control-bar     → the floating recording control bar
//   ?window=camera-bubble   → the floating webcam bubble
//   ?window=capture-overlay → one screenshot capture overlay per display
//   ?window=capture-toast   → the toast after a quiet capture
//   ?window=recording-ready → "Your video is ready", floating after a take
//   ?window=recording-shade → the countdown and the border around what is recorded
//   (default)               → the full app
const root = createRoot(document.getElementById("root")!);

/** Every floating window is transparent and paints only its own content (see main.css, which
 *  keys its per-window rules on `body[data-window]`). */
function tagWindow(kind: WindowKind): void {
  document.body.style.background = "transparent";
  document.body.dataset.window = kind;
  installCrashForwarder(kind);
}

/** What each window kind renders. The overlay is the only one that can decide to draw nothing. */
const WINDOW_TARGETS: Record<WindowKind, () => React.JSX.Element> = {
  // Transparent, display-sized window: the overlay paints its own dim sheet, which is
  // also what makes Windows deliver the clicks to it. No router, no app shell.
  "capture-overlay": () => {
    const overlayQuery = parseOverlayQuery(window.location.search);
    if (overlayQuery) return <CaptureOverlayHost query={overlayQuery} />;
    // Nothing to draw: cancel at once rather than leave a screen-covering window.
    window.electronAPI.captureOverlay.answer({ kind: "cancelled" });
    return <></>;
  },
  // Transparent, display-sized, click-through: only the marker around the region paints.
  // No `rect` means the whole display (its border, or a full-display countdown).
  "recording-shade": () => <RecordingShade />,
  // Transparent, fixed-size window: only the card paints (see main.css).
  "capture-toast": () => <CaptureToast />,
  // Transparent window sized to the card by main (see main.css); only the card paints.
  "recording-ready": () => <RecordingReadyCard />,
  // Transparent, fixed-size widget: only the bar pill paints, and it never scrolls (see
  // the `[data-window="control-bar"]` rule in main.css).
  "control-bar": () => <ControlBarWindowRoot />,
  // Transparent window: only the round bubble paints, centered (see main.css).
  "camera-bubble": () => <CameraBubble />,
  // The panel window is transparent; its own rounded background shows. Tagged so the
  // never-scroll rule in main.css applies (the panel is sized to its content; a sub-pixel
  // mismatch must not trip a scrollbar).
  "capture-panel": () => <CapturePanel />,
};

/** Pick the render target, then wrap it in the i18n provider (resolved from the
 *  persisted locale) so every window reacts to a language change. */
async function bootstrap(): Promise<void> {
  const kind = windowKindFromSearch(window.location.search);

  let node: React.JSX.Element;
  if (kind) {
    tagWindow(kind);
    node = WINDOW_TARGETS[kind]();
  } else if (import.meta.env.DEV && window.location.hash === "#stylex-probe") {
    // Experiment probe (see dev/stylex-probe.tsx); unreachable in a packaged app.
    node = <StylexProbe />;
  } else {
    node = <App />;
  }

  const withI18n = await I18nRoot({ children: node });
  root.render(<StrictMode>{withI18n}</StrictMode>);
}

void bootstrap();
