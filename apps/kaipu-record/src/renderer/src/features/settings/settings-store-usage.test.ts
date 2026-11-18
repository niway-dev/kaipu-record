import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The invariant of the renderer's settings store (ADR 0063), enforced rather than written down:
 * only `settings-store.ts` talks to `window.electronAPI.onSettingsChanged`.
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
const RENDERER_SRC = path.join(path.dirname(new URL(import.meta.url).pathname), "../..");
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

  it("no other renderer file references onSettingsChanged", () => {
    const offenders = sourceFiles(RENDERER_SRC)
      .filter((file) => file !== STORE)
      .filter((file) => readFileSync(file, "utf8").includes("onSettingsChanged"))
      .map((file) => path.relative(RENDERER_SRC, file));
    expect(offenders).toEqual([]);
  });
});
