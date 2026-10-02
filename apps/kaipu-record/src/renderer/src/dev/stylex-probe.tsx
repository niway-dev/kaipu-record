import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@kaipu/ui";
import { lightTheme } from "@kaipu/tokens/kaipu.stylex";

import "./stylex-probe.css";

/**
 * Experiment probe: the shared StyleX components rendered inside the Electron
 * renderer. Mounted only in dev and only at #stylex-probe, so it can never
 * appear in a packaged build's UI. Shows the same components twice — default
 * (dark) vars and under the generated light theme — the stage-1 proof that
 * themes are compile-time and surface-independent.
 */

/**
 * The diagnostic control: literal colors, zero token references. Where this
 * renders and the token-driven buttons do not, the renderer is missing the
 * token variables and StyleX is fine. It stays in the probe rather than
 * becoming a Button variant.
 */
const probe = stylex.create({
  raw: {
    display: "inline-flex",
    alignItems: "center",
    height: "34px",
    paddingInline: "14px",
    borderStyle: "none",
    borderRadius: "5px",
    color: "#ffffff",
    backgroundColor: { default: "#f6055c", ":hover": "#d4044f" },
  },
});

function Variants({ onCount }: { onCount: () => void }) {
  return (
    <>
      <Button onClick={onCount}>Start Recording</Button>
      <Button variant="danger">Stop Recording</Button>
      <Button variant="ghost">Maybe later</Button>
      <Button variant="outline">Change</Button>
      <Button disabled>Disabled</Button>
      <Button size="sm">Small</Button>
      <Button size="lg">Large</Button>
      <button type="button" {...stylex.props(probe.raw)}>
        raw control
      </button>
    </>
  );
}

export function StylexProbe() {
  const [clicks, setClicks] = React.useState(0);
  const count = () => setClicks((c) => c + 1);
  const row = { display: "flex", gap: 12, padding: 24, flexWrap: "wrap" } as const;
  return (
    <div style={{ padding: 24 }}>
      <div style={{ ...row, background: "#0f0f11" }}>
        <Variants onCount={count} />
      </div>
      <div {...stylex.props(lightTheme)} style={{ ...row, background: "#faf7f2" }}>
        <Variants onCount={count} />
      </div>
      <p style={{ color: "#a1a1aa", padding: "0 24px" }}>clicks: {clicks}</p>
    </div>
  );
}
