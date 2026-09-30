import type { ReactNode } from "react";

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
 */
export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div data-kl>
      <TopNav />
      <ChapterStrip />
      <Rail />
      <main>{children}</main>
      <StickyCta />
    </div>
  );
}
