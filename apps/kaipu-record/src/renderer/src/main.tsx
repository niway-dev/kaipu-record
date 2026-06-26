import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/app";
import { CapturePanel } from "./features/capture-panel/capture-panel";
import { ControlBarWindowRoot } from "./features/control-bar/control-bar-window";

// Same HTML entry, three render targets selected by query param:
//   ?mode=capture        → the menu-bar tray's compact panel
//   ?window=control-bar  → the floating recording control bar
//   (default)            → the full app
const params = new URLSearchParams(window.location.search);
const isCapturePanel = params.get("mode") === "capture";
const isControlBar = params.get("window") === "control-bar";

const root = createRoot(document.getElementById("root")!);

if (isControlBar) {
  // Transparent window — only the bar pill paints.
  document.body.style.background = "transparent";
  root.render(
    <StrictMode>
      <ControlBarWindowRoot />
    </StrictMode>,
  );
} else if (isCapturePanel) {
  // The panel window is transparent — let its own rounded background show.
  document.body.style.background = "transparent";
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
