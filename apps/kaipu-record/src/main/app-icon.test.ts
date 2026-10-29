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
const OUTPUTS = resolve(APP_DIR, "build/icon.outputs.sha256");

/**
 * Every icon file a build reads. electron-builder takes build/icon.ico for the
 * Windows .exe, the installer, the uninstaller and the shortcuts; build/icon.icns
 * and build/icon.png for macOS and Linux; the main process loads the rest. A file
 * missing from the script's outputs keeps whatever art it was hand-exported with:
 * the Windows .ico still showed the old play-mark months after the fox shipped.
 */
const SHIPPED_ICONS = [
  "build/icon.icns",
  "build/icon.png",
  "build/icon.ico",
  "resources/icon.png",
  "resources/tray-windows-recording.ico",
  "resources/tray-windows-screenshot.ico",
];

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

describe("app icon", () => {
  it("is regenerated from the current brand source", () => {
    const expected = createHash("sha256")
      .update(Buffer.concat([readFileSync(SOURCE), readFileSync(SCRIPT)]))
      .digest("hex");
    const stamp = readFileSync(STAMP, "utf8").trim();
    expect(stamp, "run `bun run icons` in apps/kaipu-record and commit the outputs").toBe(expected);
  });

  it("ships only icons the script generated, the Windows .ico included", () => {
    // `shasum -a 256` format: "<hex>  <path relative to apps/kaipu-record>" per line.
    const manifest = new Map(
      readFileSync(OUTPUTS, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const [hash, path] = line.split(/\s+\*?/);
          return [path, hash] as const;
        }),
    );
    for (const icon of SHIPPED_ICONS) {
      expect(manifest.get(icon), `${icon} is not a generate-app-icons.sh output`).toBeDefined();
      expect(sha256(readFileSync(resolve(APP_DIR, icon))), `${icon} changed after generation`).toBe(
        manifest.get(icon),
      );
    }
  });

  it("packs a Windows .ico with every size the shell asks for", () => {
    const ico = readFileSync(resolve(APP_DIR, "build/icon.ico"));
    expect(ico.readUInt16LE(2), "ICO type").toBe(1);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 24, 32, 48, 64, 128, 256]);
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
