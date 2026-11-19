import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dirnameOf, relativeId } from "../../test/source-tree";

/**
 * The invariant of the renderer's settings store (ADR 0063), enforced rather than written down:
 * only `settings-store.ts` talks to `window.electronAPI.onSettingsChanged`, and only it calls the
 * bridge's `getSettings` (so a window asks main for its settings once, however many overlays,
 * panels and hooks read them).
 *
 * The preload opens one `ipcRenderer` listener per call. When every hook subscribed for itself
 * the main window reached twelve on the Record page and Node warned
 * `MaxListenersExceededWarning`; the count had been creeping up one hook at a time, and a hand
 * kept inventory of listeners is exactly what stopped matching the code. Consumers read the
 * store with `useSettings` / `subscribeSettings` / `watchSettings` instead.
 *
 * This is source inspection, normally a junk pattern. It is kept because no behavioural test
 * catches "someone added a thirteenth listener" before a user's console does.
 */
const RENDERER_SRC = path.join(dirnameOf(import.meta.url), "../..");
const STORE = path.join(RENDERER_SRC, "features/settings/settings-store.ts");
const TEST_SUPPORT = path.join(RENDERER_SRC, "test");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full === TEST_SUPPORT) continue;
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("the settings store owns the window's settings:changed subscription", () => {
  it("scans the renderer source and finds the store itself", () => {
    const files = sourceFiles(RENDERER_SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(STORE);
    expect(readFileSync(STORE, "utf8")).toContain("onSettingsChanged");
  });

  it("no other renderer file calls the bridge's getSettings", () => {
    // The bridge method, however it is reached (`window.electronAPI.getSettings`, an injected
    // `api.getSettings`, or a `Pick<..., "getSettings">` of the bridge). A media track's own
    // `track.getSettings()` is another API and does not match.
    const bridgeRead = /(?:electronAPI|\bapi)\??\.getSettings\b|["']getSettings["']/;
    const offenders = sourceFiles(RENDERER_SRC)
      .filter((file) => file !== STORE)
      .filter((file) => bridgeRead.test(readFileSync(file, "utf8")))
      .map((file) => relativeId(RENDERER_SRC, file));
    expect(offenders).toEqual([]);
  });

  it("the bridge pattern matches the reads it is meant to catch", () => {
    const bridgeRead = /(?:electronAPI|\bapi)\??\.getSettings\b|["']getSettings["']/;
    expect(bridgeRead.test("window.electronAPI.getSettings()")).toBe(true);
    expect(bridgeRead.test("api.getSettings?.()")).toBe(true);
    expect(bridgeRead.test('Pick<KaipuElectronAPI, "getSettings">')).toBe(true);
    expect(bridgeRead.test("track.getSettings().deviceId")).toBe(false);
  });

  it("no other renderer file references onSettingsChanged", () => {
    const offenders = sourceFiles(RENDERER_SRC)
      .filter((file) => file !== STORE)
      .filter((file) => readFileSync(file, "utf8").includes("onSettingsChanged"))
      .map((file) => relativeId(RENDERER_SRC, file));
    expect(offenders).toEqual([]);
  });
});
