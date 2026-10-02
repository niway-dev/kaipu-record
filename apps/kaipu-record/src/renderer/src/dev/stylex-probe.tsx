import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { KaipuButton } from "@kaipu/ui";
import { lightTheme } from "@kaipu/tokens/kaipu.stylex";

import "./stylex-probe.css";

/**
 * Experiment probe: the shared StyleX button rendered inside the Electron
 * renderer. Mounted only in dev and only at #stylex-probe, so it can never
 * appear in a packaged build's UI. Shows the same components twice — default
 * (dark) vars and under the generated light theme — the stage-1 proof that
 * themes are compile-time and surface-independent. Delete with the experiment.
 */
export function StylexProbe() {
  const [clicks, setClicks] = React.useState(0);
  const row = { display: "flex", gap: 16, padding: 24, alignItems: "center" } as const;
  return (
    <div style={{ padding: 24 }}>
      <div style={{ ...row, background: "#0f0f11" }}>
        <KaipuButton onClick={() => setClicks((c) => c + 1)}>
          Record a moment ({clicks})
        </KaipuButton>
        <KaipuButton variant="ghost">Maybe later</KaipuButton>
        <KaipuButton variant="raw">raw control</KaipuButton>
      </div>
      <div {...stylex.props(lightTheme)} style={{ ...row, background: "#faf7f2" }}>
        <KaipuButton onClick={() => setClicks((c) => c + 1)}>
          Record a moment ({clicks})
        </KaipuButton>
        <KaipuButton variant="ghost">Maybe later</KaipuButton>
        <KaipuButton variant="raw">raw control</KaipuButton>
      </div>
    </div>
  );
}
