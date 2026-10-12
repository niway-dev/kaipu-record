import { fileURLToPath } from "node:url";

/**
 * Where our own renderer pages are allowed to come from. Pure and Electron-free
 * so the rule can be unit tested; `app-origin.ts` supplies the real values.
 */
export interface TrustedOrigin {
  /** Absolute path of the packaged renderer entry (`out/renderer/index.html`). */
  rendererFilePath: string;
  /** Origin of the dev server (`ELECTRON_RENDERER_URL`) — set in development only. */
  devOrigin?: string;
}

/** True when `url` is one of our own renderer pages (query string and hash are ignored). */
export function isTrustedAppUrl(url: string | undefined | null, trusted: TrustedOrigin): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "file:") {
    // `fileURLToPath` decodes percent escapes, so `%2e%2e` tricks compare equal
    // only if they genuinely resolve to the entry file.
    try {
      return fileURLToPath(parsed) === trusted.rendererFilePath;
    } catch {
      return false;
    }
  }
  if (trusted.devOrigin) return parsed.origin === new URL(trusted.devOrigin).origin;
  return false;
}
