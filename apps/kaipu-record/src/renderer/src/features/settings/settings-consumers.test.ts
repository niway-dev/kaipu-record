import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dirnameOf, relativeId } from "../../test/source-tree";
import { SETTINGS_CONSUMERS } from "./settings-consumers";

/**
 * The map in `settings-consumers.ts` is the source of truth for who reads the window's settings
 * (ADR 0063), so it must match the code. A consumer is a non-test renderer file that imports the
 * store (`settings-store`) or its wrapper `useAppSettings` (`use-app-settings`) as a value.
 *
 * Source inspection, kept for the same reason as `settings-store-usage.test.ts`: nothing else
 * notices a new consumer that nobody wrote down, and a stale hand-kept list is what this map
 * replaces. A type-only import (`import type`) reads nothing at runtime and is not a consumer.
 */
const RENDERER_SRC = path.join(dirnameOf(import.meta.url), "../..");
const TEST_SUPPORT = path.join(RENDERER_SRC, "test");
const STORE = path.join(RENDERER_SRC, "features/settings/settings-store.ts");
const MAP = path.join(RENDERER_SRC, "features/settings/settings-consumers.ts");

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

const TYPE_ONLY_IMPORT = /import\s+type\s[^;]*?from\s+["'][^"']+["'];?/gs;
// The module name starts at a path segment, so `export-settings-store` (the export dialog's own
// store, not the window's settings) is not mistaken for `settings-store`.
const STORE_IMPORT = /["'](?:[^"']*\/)?(?:settings-store|use-app-settings)["']/;

/** Whether `source` takes a value from the store or from `useAppSettings`. */
function importsSettingsStore(source: string): boolean {
  return STORE_IMPORT.test(source.replace(TYPE_ONLY_IMPORT, ""));
}

const relative = (file: string): string => relativeId(RENDERER_SRC, file);

describe("the settings consumers map matches the renderer", () => {
  const consumers = sourceFiles(RENDERER_SRC)
    .filter((file) => file !== STORE && file !== MAP)
    .filter((file) => importsSettingsStore(readFileSync(file, "utf8")))
    .map(relative)
    .sort();

  it("finds the consumers it is meant to find", () => {
    expect(consumers.length).toBeGreaterThan(20);
    expect(consumers).toContain("app/i18n-root.tsx");
    expect(consumers).toContain("pages/settings/use-app-settings.ts");
  });

  it("recognises a value import and ignores a type-only one", () => {
    expect(importsSettingsStore('import { useSettings } from "@renderer/x/settings-store";')).toBe(
      true,
    );
    expect(importsSettingsStore('const m = await import("./settings-store");')).toBe(true);
    expect(
      importsSettingsStore('import { useAppSettings } from "../pages/settings/use-app-settings";'),
    ).toBe(true);
    expect(
      importsSettingsStore(
        'import type { AppSettingsStore } from "@renderer/pages/settings/use-app-settings";',
      ),
    ).toBe(false);
    expect(importsSettingsStore('import { x } from "./other";')).toBe(false);
    expect(
      importsSettingsStore('import { x } from "@renderer/features/export/export-settings-store";'),
    ).toBe(false);
  });

  it("every consumer in the renderer is in the map", () => {
    const listed = new Set(SETTINGS_CONSUMERS.map((entry) => entry.file));
    expect(consumers.filter((file) => !listed.has(file))).toEqual([]);
  });

  it("every file in the map exists and still reads the store", () => {
    const stale = SETTINGS_CONSUMERS.map((entry) => entry.file).filter(
      (file) => !consumers.includes(file),
    );
    expect(stale).toEqual([]);
  });

  it("lists each file once", () => {
    const files = SETTINGS_CONSUMERS.map((entry) => entry.file);
    expect(files.filter((file, index) => files.indexOf(file) !== index)).toEqual([]);
  });

  it("names, for each entry, keys that the file mentions", () => {
    const missing = SETTINGS_CONSUMERS.flatMap((entry) => {
      if (entry.keys === "all") return [];
      const source = readFileSync(path.join(RENDERER_SRC, entry.file), "utf8");
      return entry.keys
        .filter((key) => !new RegExp(`\\b${key}\\b`).test(source))
        .map((key) => `${entry.file}: ${key}`);
    });
    expect(missing).toEqual([]);
  });

  it("points every entry at a behaviour test that exists", () => {
    const broken = SETTINGS_CONSUMERS.flatMap((entry) => {
      const { behaviour } = entry;
      if (behaviour === "here") return [];
      const file = path.join(RENDERER_SRC, behaviour.coveredIn);
      if (!existsSync(file)) return [`${entry.file}: ${behaviour.coveredIn} does not exist`];
      const source = readFileSync(file, "utf8");
      return behaviour.mentions
        .filter((name) => !source.includes(name))
        .map((name) => `${entry.file}: ${behaviour.coveredIn} does not mention ${name}`);
    });
    expect(broken).toEqual([]);
  });

  it("a file covered through the useAppSettings hook reads only through the hook", () => {
    // Its follow-the-store test is the hook's own (`use-app-settings.test.tsx`), so the file
    // must not bypass the hook with a one-time read (it would not follow, and nothing else fails).
    const bypass = SETTINGS_CONSUMERS.flatMap((entry) => {
      const { behaviour } = entry;
      if (behaviour === "here" || !behaviour.coveredIn.endsWith("use-app-settings.test.tsx")) {
        return [];
      }
      const source = readFileSync(path.join(RENDERER_SRC, entry.file), "utf8");
      const reads = ["getSettingsSnapshot(", "loadSettings("].filter((call) =>
        source.includes(call),
      );
      const hooked = source.includes("useAppSettings(");
      return !hooked || reads.length > 0
        ? [
            `${entry.file}: uses the hook ${hooked}, reads once with ${reads.join(", ") || "nothing"}`,
          ]
        : [];
    });
    expect(bypass).toEqual([]);
  });
});
