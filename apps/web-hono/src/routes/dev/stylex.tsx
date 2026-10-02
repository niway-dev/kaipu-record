import { createFileRoute } from "@tanstack/react-router";
import { KaipuButton } from "@kaipu/ui";

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
  return (
    <div style={{ display: "flex", gap: 16, padding: 48 }}>
      <KaipuButton onClick={() => console.log("primary")}>Record a moment</KaipuButton>
      <KaipuButton variant="ghost">Maybe later</KaipuButton>
    </div>
  );
}
