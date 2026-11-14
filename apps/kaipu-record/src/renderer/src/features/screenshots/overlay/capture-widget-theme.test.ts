import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "capture-widget.module.css"),
  "utf8",
);

/**
 * Tokens whose value differs between `:root` (dark) and `[data-theme="light"]` in
 * `packages/tokens/css/tokens.css`. The overlay window runs `applyTheme`, so any of these would
 * turn the widget light under its white selected-state text. Tokens identical in both themes
 * (`--accent-primary`, `--accent-primary-hover`, `--font-*`, `--transition`) are fine.
 */
const THEME_VARYING = [
  "--bg-app",
  "--bg-sidebar",
  "--bg-card",
  "--bg-card-hover",
  "--bg-input",
  "--bg-modal",
  "--bg-overlay",
  "--bg-canvas",
  "--bg-panel",
  "--bg-raised",
  "--bg-hover",
  "--bg-active",
  "--line",
  "--line-strong",
  "--border",
  "--border-light",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text",
  "--text-2",
  "--text-3",
  "--text-4",
  "--accent-soft",
  "--accent-ring",
  "--shadow-popover",
  "--accent-primary-soft",
  "--accent-primary-ring",
  "--glow-accent",
  "--accent-green",
  "--accent-red",
  "--accent-red-hover",
  "--accent-yellow",
  "--accent-purple",
  "--accent-secondary",
];

describe("capture widget stays dark in every theme (ADR 0056)", () => {
  it("references no token that differs in the light theme", () => {
    const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]);
    const offenders = [...new Set(used.filter((name) => THEME_VARYING.includes(name)))];
    expect(offenders).toEqual([]);
  });
});
