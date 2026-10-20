import type { DownloadPlatform } from "./analytics";

/**
 * Resolve the public download URLs for the desktop app. The base is the R2 public
 * bucket (set VITE_PUBLIC_DOWNLOAD_URL at build); falls back to a sane default so
 * the page still renders in dev. Stable `download/latest/` paths — CI keeps them current.
 */
const BASE = import.meta.env.VITE_PUBLIC_DOWNLOAD_URL ?? "https://updates.kaipu.app";

export const downloadUrls = {
  macArm64: `${BASE}/download/latest/kaipu-arm64.dmg`,
  macX64: `${BASE}/download/latest/kaipu-x64.dmg`,
  /** The Windows beta's NSIS installer. Unsigned for now, so SmartScreen asks once. */
  windowsX64: `${BASE}/download/latest/kaipu-setup.exe`,
} as const;

/** Which installer a download URL points at, or null for a URL that is not one of ours. */
export function platformForUrl(href: string): DownloadPlatform | null {
  if (href === downloadUrls.macArm64) return "mac-arm64";
  if (href === downloadUrls.macX64) return "mac-x64";
  if (href === downloadUrls.windowsX64) return "windows";
  return null;
}
