export type DesktopOs = "mac" | "windows" | "other";

interface NavigatorLike {
  userAgentData?: { platform?: string; mobile?: boolean };
  userAgent?: string;
  maxTouchPoints?: number;
}

/**
 * Which desktop installer to feature. Prefers `navigator.userAgentData.platform` (Chromium) and
 * falls back to the user agent. Phones and tablets are "other": an iPad reports itself as a Mac,
 * so a touch screen on a "Mac" gives it away. "other" shows every download equally.
 */
export function detectDesktopOs(nav: NavigatorLike | undefined): DesktopOs {
  if (!nav) return "other";
  const ua = nav.userAgent ?? "";
  if (nav.userAgentData?.mobile || /android|iphone|ipad|ipod|mobile/i.test(ua)) return "other";

  const platform = (nav.userAgentData?.platform ?? "").toLowerCase();
  if (platform === "macos") return "mac";
  if (platform === "windows") return "windows";

  if (/macintosh|mac os x/i.test(ua)) return (nav.maxTouchPoints ?? 0) > 1 ? "other" : "mac";
  if (/windows/i.test(ua)) return "windows";
  return "other";
}
