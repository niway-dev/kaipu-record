import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/app";
import { CapturePanel } from "./features/capture-panel/capture-panel";

// Same HTML entry, two render targets. The menu-bar tray opens this renderer
// with `?mode=capture`, which renders the compact panel instead of the full app.
const isCapturePanel = new URLSearchParams(window.location.search).get("mode") === "capture";

const root = createRoot(document.getElementById("root")!);

if (isCapturePanel) {
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
