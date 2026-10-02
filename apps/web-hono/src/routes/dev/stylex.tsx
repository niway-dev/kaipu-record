import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@kaipu/ui";
import { lightTheme } from "@kaipu/tokens/kaipu.stylex";

import stylexCss from "../../stylex.css?url";

/**
 * Experiment probe, not a product page: renders the shared StyleX components so
 * the compiled output can be inspected on a real route. Unlinked; reach it at
 * /dev/stylex.
 */
export const Route = createFileRoute("/dev/stylex")({
  head: () => ({
    links: [{ rel: "stylesheet", href: stylexCss }],
  }),
  component: StylexProbe,
});

/**
 * The diagnostic control: literal colors, zero token references. Where this
 * renders and the token-driven buttons do not, the surface is missing the token
 * variables and StyleX is fine. It lives in the probe rather than as a Button
 * variant, so a debugging aid never reaches the product's API.
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

function Variants() {
  return (
    <>
      <Button onClick={() => console.log("primary")}>Start Recording</Button>
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

function StylexProbe() {
  const row = { display: "flex", gap: 12, padding: 24, flexWrap: "wrap" } as const;
  return (
    <div style={{ padding: 24 }}>
      {/* Default vars = dark values, no theme applied. */}
      <div style={{ ...row, background: "#0f0f11" }}>
        <Variants />
      </div>
      {/* Same components under the generated light theme — both at once is the
          stage-1 proof that themes are compile-time and surface-independent. */}
      <div {...stylex.props(lightTheme)} style={{ ...row, background: "#faf7f2" }}>
        <Variants />
      </div>
    </div>
  );
}
