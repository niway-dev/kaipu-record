import type { ReactNode } from "react";

import { LandingNav } from "./landing-nav";
import { Footer } from "./footer";
import { useLandingTheme } from "@/components/theme-toggle";

/**
 * Chrome for every public page: the marketing nav, the marketing footer, and the
 * landing theme. Routes that render this must declare
 * `staticData: { shell: "marketing" }` so the root document stands down —
 * otherwise the page gets this header *and* the app one.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const theme = useLandingTheme();
  return (
    <div
      data-theme={theme === "light" ? "light" : undefined}
      className="min-h-screen bg-[var(--kaipu-bg-app)] text-[var(--kaipu-text-primary)]"
    >
      <LandingNav />
      {children}
      <Footer />
    </div>
  );
}
