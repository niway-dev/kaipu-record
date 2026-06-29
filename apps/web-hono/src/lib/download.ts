/**
 * Resolve the public download URLs for the desktop app. The base is the R2 public
 * bucket (set VITE_PUBLIC_DOWNLOAD_URL at build); falls back to a sane default so
 * the page still renders in dev. Stable `download/latest/` paths — CI keeps them current.
 */
const BASE = import.meta.env.VITE_PUBLIC_DOWNLOAD_URL ?? "https://updates.kaipu.app";

export const downloadUrls = {
  macArm64: `${BASE}/download/latest/kaipu-arm64.dmg`,
  macX64: `${BASE}/download/latest/kaipu-x64.dmg`,
} as const;
