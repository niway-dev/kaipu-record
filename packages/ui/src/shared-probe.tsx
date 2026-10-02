import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { KaipuButton } from "./button";

/**
 * Deliberately crude experiment marker: one heading and one button, written
 * once, mounted at the top of BOTH main screens (web home and the desktop
 * app) so the shared-styling experiment is visible in situ. Styled with
 * StyleX over the same tokens as the button. Remove with the experiment.
 */
const styles = stylex.create({
  banner: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    margin: 0,
    paddingBlock: "14px",
    paddingInline: "20px",
    backgroundColor: "var(--kaipu-bg-card)",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--kaipu-border)",
    color: "var(--kaipu-text-primary)",
    fontSize: "20px",
    fontWeight: 700,
    lineHeight: "28px",
  },
});

export function SharedProbe() {
  const [clicks, setClicks] = useState(0);
  return (
    <h1 {...stylex.props(styles.banner)}>
      shared component
      <KaipuButton onClick={() => setClicks((c) => c + 1)}>
        tokens{clicks > 0 ? ` (${clicks})` : ""}
      </KaipuButton>
      <KaipuButton variant="raw" onClick={() => setClicks((c) => c + 1)}>
        raw css{clicks > 0 ? ` (${clicks})` : ""}
      </KaipuButton>
    </h1>
  );
}
