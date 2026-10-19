import { useRouteContext, useRouter } from "@tanstack/react-router";

import { useSignOut } from "@/hooks/use-session";
import { setLandingTheme } from "@/server-functions/set-landing-theme";

/**
 * The account controls the dashboard frame offers: the theme (the landing's cookie, shared with
 * the home and the sign-in pages) and Sign out. The sidebar shows them on desktop; on a phone they
 * sit at the foot of Settings.
 */
export function useDashboardControls() {
  const { landingTheme } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const signOut = useSignOut();

  const toggleTheme = async () => {
    await setLandingTheme({ data: landingTheme === "dark" ? "light" : "dark" });
    await router.invalidate();
  };

  return {
    theme: landingTheme,
    toggleTheme: () => void toggleTheme(),
    signOut: () => signOut.mutate(),
    signingOut: signOut.isPending,
  };
}
