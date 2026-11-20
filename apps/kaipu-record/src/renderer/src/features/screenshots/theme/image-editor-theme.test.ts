import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "image-editor-theme.css"),
  "utf8",
);

/** Declarations of the block that opens with `selector`, as token -> value. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `block ${selector} exists`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.replace(/\s+/g, " ").trim();
  }
  return out;
}

// The owner's M11 mock (NIW2-708). `null` for light means "same as dark": the chrome drawn over
// the image is always dark, so the light block does not redefine it.
const TOKENS: Array<[string, string, string | null]> = [
  ["--ie-app", "#060607", "#fafafa"],
  ["--ie-stage", "#060607", "#f1f1f3"],
  ["--ie-panel", "#0b0b0d", "#ffffff"],
  ["--ie-card", "#0e0e10", "#ffffff"],
  ["--ie-hover", "#17171a", "#eeeef1"],
  ["--ie-sep", "rgba(255,255,255,.08)", "rgba(0,0,0,.09)"],
  ["--ie-strong", "rgba(255,255,255,.14)", "rgba(0,0,0,.18)"],
  ["--ie-tx", "#e8e8ed", "#18181b"],
  ["--ie-tx2", "#c8c8d0", "#3f3f46"],
  ["--ie-mut", "#a1a1aa", "#6a6a73"],
  ["--ie-faint", "#62626a", "#9a9aa2"],
  ["--ie-dot", "rgba(255,255,255,.08)", "rgba(0,0,0,.13)"],
  ["--ie-shadow", "0 24px 60px -20px rgba(0,0,0,.85)", "0 18px 40px -18px rgba(0,0,0,.3)"],
  ["--ie-export-dash", "rgba(255,255,255,.3)", "rgba(0,0,0,.34)"],
  ["--ie-accent", "#f6055c", "#f6055c"],
  ["--ie-accent-soft", "rgba(246,5,92,.14)", "rgba(246,5,92,.14)"],
  ["--ie-ov-bg", "rgba(11,11,13,.94)", null],
  ["--ie-ov-bd", "rgba(255,255,255,.24)", null],
  ["--ie-ov-tx", "#e8e8ed", null],
  ["--ie-ov-hover", "rgba(255,255,255,.14)", null],
  ["--ie-ov-track", "rgba(255,255,255,.1)", null],
  ["--ie-dim", "rgba(6,6,7,.68)", null],
  ["--ie-ink-light", "#fff", null],
  ["--ie-ink-dark", "#000", null],
  ["--ie-ok", "#4ade80", null],
  ["--ie-ok-chrome", "#22c55e", null],
];

const squash = (v: string): string => v.replace(/\s+/g, "").replace(/(^|[^0-9])0\./g, "$1.");

describe("image editor theme tokens", () => {
  const dark = block(":root");
  const light = block(':root[data-theme="light"]');

  it.each(TOKENS)("%s has the mock's dark and light values", (name, darkValue, lightValue) => {
    expect(squash(dark[name] ?? "MISSING")).toBe(squash(darkValue));
    expect(squash(light[name] ?? dark[name] ?? "MISSING")).toBe(squash(lightValue ?? darkValue));
  });

  it("points --ie-font-mono at the app's mono font variable", () => {
    expect(dark["--ie-font-mono"]).toBe("var(--font-mono)");
  });

  it("defines nothing else with the --ie- prefix by accident", () => {
    const known = new Set([...TOKENS.map(([n]) => n), "--ie-font-mono"]);
    for (const name of [...Object.keys(dark), ...Object.keys(light)]) {
      expect(known.has(name), `${name} is in the pinned table`).toBe(true);
    }
  });
});
