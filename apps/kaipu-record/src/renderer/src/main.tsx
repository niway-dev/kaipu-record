import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/app";
import { CapturePanel } from "./features/capture-panel/capture-panel";
import { ControlBarWindowRoot } from "./features/control-bar/control-bar-window";
import { CameraBubble } from "./features/camera-bubble/camera-bubble";
import { installCrashForwarder } from "./features/analytics/crash-forwarder";
import { I18nRoot } from "./app/i18n-root";

// Same HTML entry, four render targets selected by query param:
//   ?mode=capture         → the menu-bar tray's compact panel
//   ?window=control-bar   → the floating recording control bar
//   ?window=camera-bubble → the floating webcam bubble
//   (default)             → the full app
const root = createRoot(document.getElementById("root")!);

/** Pick the render target, then wrap it in the i18n provider (resolved from the
 *  persisted locale) so every window reacts to a language change. */
async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const isCapturePanel = params.get("mode") === "capture";
  const windowKind = params.get("window");
  const isControlBar = windowKind === "control-bar";
  const isCameraBubble = windowKind === "camera-bubble";

  let node: React.JSX.Element;
  if (isControlBar) {
    // Transparent, fixed-size widget — only the bar pill paints, and it never
    // scrolls (see the `[data-window="control-bar"]` rule in main.css).
    document.body.style.background = "transparent";
    document.body.dataset.window = "control-bar";
    installCrashForwarder("control-bar");
    node = <ControlBarWindowRoot />;
  } else if (isCameraBubble) {
    // Transparent window — only the round bubble paints, centered (see main.css).
    document.body.style.background = "transparent";
    document.body.dataset.window = "camera-bubble";
    installCrashForwarder("camera-bubble");
    node = <CameraBubble />;
  } else if (isCapturePanel) {
    // The panel window is transparent — let its own rounded background show.
    // Tag it so the never-scroll rule in main.css applies (the panel is sized to
    // its content; a sub-pixel mismatch must not trip a scrollbar).
    document.body.style.background = "transparent";
    document.body.dataset.window = "capture-panel";
    installCrashForwarder("capture-panel");
    node = <CapturePanel />;
  } else {
    node = <App />;
  }

  const withI18n = await I18nRoot({ children: node });
  root.render(<StrictMode>{withI18n}</StrictMode>);
}

void bootstrap();
