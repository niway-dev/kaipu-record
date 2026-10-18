/**
 * The host OS as the renderer sees it, from the preload bridge
 * (`window.electronAPI.platform`, which is `process.platform` in preload). The
 * renderer must not read `process` itself, and every platform-dependent label or
 * toggle reads this one source rather than the browser's own report.
 *
 * Falls back to macOS when the bridge reports nothing (a bare unit test with no
 * preload), which keeps the macOS-first test expectations valid.
 */
export function hostPlatform(): string {
  return typeof window !== "undefined" ? (window.electronAPI?.platform ?? "darwin") : "darwin";
}

/** True when the bridge reports Windows: hide macOS-only UI and pick the Windows copy. */
export function isWindowsHost(platform: string = hostPlatform()): boolean {
  return platform === "win32";
}
