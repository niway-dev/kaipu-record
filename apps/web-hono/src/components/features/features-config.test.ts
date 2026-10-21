import { describe, expect, it } from "vitest";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

import { COMING_NEXT, FEATURE_CHAPTERS, FEATURE_COUNT, PRIVACY } from "./features-config";

/** Every `features` message key the config hands to `t()`. */
function configKeys(): string[] {
  const keys: string[] = [];
  for (const chapter of FEATURE_CHAPTERS) {
    keys.push(chapter.name, chapter.line, chapter.title, chapter.serif, chapter.intro);
    for (const feature of chapter.features) {
      keys.push(feature.title, feature.body);
      if ("details" in feature) keys.push(...feature.details);
      if ("chips" in feature) keys.push(...feature.chips.map((chip) => chip.key));
    }
  }
  for (const { id } of PRIVACY) keys.push(`private.items.${id}.title`, `private.items.${id}.body`);
  for (const { id } of COMING_NEXT) keys.push(`next.items.${id}`);
  return keys;
}

function lookup(catalog: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      (catalog as { features: unknown }).features,
    );
}

describe("features config", () => {
  // The keys are typed as plain strings in the config (see FeatureMessageKey), so
  // this is what stops a typo from rendering a raw key on the public page.
  it.each([
    ["en", en],
    ["es", es],
  ])("every key resolves to a non-empty string in %s", (_locale, catalog) => {
    const missing = configKeys().filter((key) => {
      const value = lookup(catalog, key);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(missing).toEqual([]);
  });

  it("keeps feature ids unique, so React keys and anchors never collide", () => {
    const ids = FEATURE_CHAPTERS.flatMap((c) => c.features.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(FEATURE_COUNT).toBe(ids.length);
  });

  it("uses the home's chapter ids, which the rail and mobile strip scroll-spy on", () => {
    expect(FEATURE_CHAPTERS.map((c) => c.id)).toEqual(["record", "capture", "edit", "find"]);
  });
});
