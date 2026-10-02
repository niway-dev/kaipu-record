import * as React from "react";
import { KaipuButton } from "@kaipu/ui";

import "./stylex-probe.css";

/**
 * Experiment probe: the shared StyleX button rendered inside the Electron
 * renderer. Mounted only in dev and only at #stylex-probe, so it can never
 * appear in a packaged build's UI. Delete with the experiment's verdict.
 */
export function StylexProbe() {
  const [clicks, setClicks] = React.useState(0);
  return (
    <div style={{ display: "flex", gap: 16, padding: 48, alignItems: "center" }}>
      <KaipuButton onClick={() => setClicks((c) => c + 1)}>Record a moment ({clicks})</KaipuButton>
      <KaipuButton variant="ghost">Maybe later</KaipuButton>
    </div>
  );
}
