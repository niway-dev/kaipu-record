import type { ReactNode } from "react";
import { useRouteContext } from "@tanstack/react-router";

import { SharedProbe } from "@kaipu/ui";

import { ChapterStrip } from "./chapter-strip";
import { Rail } from "./rail";
import { StickyCta } from "./sticky-cta";
import { TopNav } from "./top-nav";
import "@/styles/landing.css";

/**
 * Chrome for the redesigned home. Deliberately NOT PublicShell: it has its own
 * top bar and the chapter rail, and it owns a dark token layer rather than the
 * app's theme.
 *
 * `data-kl` is the hook every landing style hangs off. Nothing in
 * styles/landing*.css applies without it, which is what keeps this page from
 * leaking into the roadmap, legal and authenticated routes that still use
 * PublicShell.
 *
 * `data-kl-theme` selects which of the two token columns in landing-tokens.css
 * wins. It comes from the route context, which read the cookie on the server,
 * so the first paint is already the visitor's theme — no flash, nothing to
 * correct on hydration.
 */
export function HomeShell({ children }: { children: ReactNode }) {
  const { landingTheme } = useRouteContext({ from: "__root__" });

  return (
    <div data-kl data-kl-theme={landingTheme}>
      {/* StyleX experiment: shared with the desktop app's main screen. */}
      <SharedProbe />
      <TopNav />
      <ChapterStrip />
      <Rail />
      <main>{children}</main>
      <StickyCta />
    </div>
  );
}
