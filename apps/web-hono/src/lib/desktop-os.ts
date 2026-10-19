export type DesktopOs = "mac" | "windows" | "other";

interface NavigatorLike {
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/**
 * Which desktop installer to put first. Phones and tablets report a desktop-looking platform
 * ("iPad" masquerades as a Mac in some modes, Android UAs say "Linux"), but none of them can run the
 * desktop app, so they get the plain list of links like Linux does.
 */
export function detectDesktopOs(nav: NavigatorLike | undefined): DesktopOs {
  if (!nav) return "other";
  const hint = nav.userAgentData?.platform?.toLowerCase() ?? "";
  const ua = (nav.userAgent ?? "").toLowerCase();
  if (/iphone|ipad|ipod|android/.test(ua)) return "other";
  if (hint === "macos" || (!hint && ua.includes("macintosh"))) return "mac";
  if (hint === "windows" || (!hint && ua.includes("windows"))) return "windows";
  return "other";
}
