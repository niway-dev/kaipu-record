import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/app";
import { CapturePanel } from "./features/capture-panel/capture-panel";
import { ControlBarWindowRoot } from "./features/control-bar/control-bar-window";
import { CameraBubble } from "./features/camera-bubble/camera-bubble";
import { installCrashForwarder } from "./features/analytics/crash-forwarder";

// Same HTML entry, four render targets selected by query param:
//   ?mode=capture         → the menu-bar tray's compact panel
//   ?window=control-bar   → the floating recording control bar
//   ?window=camera-bubble → the floating webcam bubble
//   (default)             → the full app
const params = new URLSearchParams(window.location.search);
const isCapturePanel = params.get("mode") === "capture";
const windowKind = params.get("window");
const isControlBar = windowKind === "control-bar";
const isCameraBubble = windowKind === "camera-bubble";

const root = createRoot(document.getElementById("root")!);

if (isControlBar) {
  // Transparent, fixed-size widget — only the bar pill paints, and it never
  // scrolls (see the `[data-window="control-bar"]` rule in main.css).
  document.body.style.background = "transparent";
  document.body.dataset.window = "control-bar";
  installCrashForwarder("control-bar");
  root.render(
    <StrictMode>
      <ControlBarWindowRoot />
    </StrictMode>,
  );
} else if (isCameraBubble) {
  // Transparent window — only the round bubble paints, centered (see main.css).
  document.body.style.background = "transparent";
  document.body.dataset.window = "camera-bubble";
  installCrashForwarder("camera-bubble");
  root.render(
    <StrictMode>
      <CameraBubble />
    </StrictMode>,
  );
} else if (isCapturePanel) {
  // The panel window is transparent — let its own rounded background show.
  document.body.style.background = "transparent";
  installCrashForwarder("capture-panel");
  root.render(
    <StrictMode>
      <CapturePanel />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
