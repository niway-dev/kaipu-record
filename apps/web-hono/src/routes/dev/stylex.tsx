import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { KaipuButton } from "@kaipu/ui";
import { lightTheme } from "@kaipu/tokens/kaipu.stylex";

import stylexCss from "../../stylex.css?url";

/**
 * Experiment probe, not a product page: renders the shared StyleX button so
 * the compiled output can be inspected on a real route. Unlinked; reach it at
 * /dev/stylex. Delete together with the experiment branch verdict.
 */
export const Route = createFileRoute("/dev/stylex")({
  head: () => ({
    links: [{ rel: "stylesheet", href: stylexCss }],
  }),
  component: StylexProbe,
});

function StylexProbe() {
  const row = { display: "flex", gap: 16, padding: 24 } as const;
  return (
    <div style={{ padding: 24 }}>
      {/* Default vars = dark values, no theme applied. */}
      <div style={{ ...row, background: "#0f0f11" }}>
        <KaipuButton onClick={() => console.log("primary")}>Record a moment</KaipuButton>
        <KaipuButton variant="ghost">Maybe later</KaipuButton>
        <KaipuButton variant="raw">raw control</KaipuButton>
      </div>
      {/* Same components under the generated light theme — both at once is the
          stage-1 proof that themes are compile-time and surface-independent. */}
      <div {...stylex.props(lightTheme)} style={{ ...row, background: "#faf7f2" }}>
        <KaipuButton onClick={() => console.log("primary")}>Record a moment</KaipuButton>
        <KaipuButton variant="ghost">Maybe later</KaipuButton>
        <KaipuButton variant="raw">raw control</KaipuButton>
      </div>
    </div>
  );
}
