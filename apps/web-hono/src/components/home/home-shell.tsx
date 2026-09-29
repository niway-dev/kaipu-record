import type { ReactNode } from "react";

import { Rail } from "./rail";
import "@/styles/landing.css";

/**
 * Chrome for the redesigned home. Deliberately NOT PublicShell: this page has no
 * top nav — the rail is its only navigation — and it owns its own dark token
 * layer rather than the app's theme.
 *
 * `data-kl` is the hook every landing style hangs off. Nothing in
 * styles/landing*.css applies without it, which is what keeps this page from
 * leaking into the roadmap, legal and authenticated routes that still use
 * PublicShell.
 */
export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div data-kl>
      <Rail />
      <main>{children}</main>
    </div>
  );
}
