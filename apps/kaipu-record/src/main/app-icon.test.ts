import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The OS-facing icons (build/icon.icns, build/icon.png, resources/icon.png) are
 * derived from the brand package by scripts/generate-app-icons.sh, which records
 * the hash of its inputs. If the logo or the script changes without re-running
 * it, the Dock and ⌘-Tab silently keep the old icon (NIW2-181) — this catches it.
 * Rendering needs macOS `sips`, so CI compares the stamp instead of re-rendering.
 */
const APP_DIR = resolve(__dirname, "../..");
const SOURCE = resolve(APP_DIR, "../../packages/brand/assets/logo-app.svg");
const SCRIPT = resolve(APP_DIR, "scripts/generate-app-icons.sh");
const STAMP = resolve(APP_DIR, "build/icon.source.sha256");

describe("app icon", () => {
  it("is regenerated from the current brand source", () => {
    const expected = createHash("sha256")
      .update(Buffer.concat([readFileSync(SOURCE), readFileSync(SCRIPT)]))
      .digest("hex");
    const stamp = readFileSync(STAMP, "utf8").trim();
    expect(stamp, "run `bun run icons` in apps/kaipu-record and commit the outputs").toBe(expected);
  });

  it("ships a macOS .icns and the PNGs the main process and builder read", () => {
    const icns = readFileSync(resolve(APP_DIR, "build/icon.icns"));
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    for (const png of ["build/icon.png", "resources/icon.png"]) {
      const header = readFileSync(resolve(APP_DIR, png)).subarray(1, 4).toString("ascii");
      expect(header, png).toBe("PNG");
    }
  });
});
