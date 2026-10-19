import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { trayIconFor, type TrayIconFile } from "./tray-icon";

const RESOURCES = resolve(__dirname, "../../resources");

describe("trayIconFor", () => {
  it("uses the black template PNGs on macOS, recoloured by the menu bar", () => {
    expect(trayIconFor("record", "darwin")).toEqual({
      file: "tray-recording.png",
      template: true,
    });
    expect(trayIconFor("screenshot", "darwin")).toEqual({
      file: "tray-screenshot.png",
      template: true,
    });
  });

  it("uses the light .ico files on Windows, never as a template", () => {
    expect(trayIconFor("record", "win32")).toEqual({
      file: "tray-windows-recording.ico",
      template: false,
    });
    expect(trayIconFor("screenshot", "win32")).toEqual({
      file: "tray-windows-screenshot.ico",
      template: false,
    });
  });

  it("keeps Linux on the template PNGs it used before", () => {
    expect(trayIconFor("record", "linux").file).toBe("tray-recording.png");
  });
});

/**
 * The .ico files are derived by scripts/generate-app-icons.sh. Checked as files
 * here: a multi-size icon with the 16/24/32 px entries the Windows notification
 * area asks for, each a PNG.
 */
describe("Windows tray .ico files", () => {
  const icoFiles: TrayIconFile[] = ["tray-windows-recording.ico", "tray-windows-screenshot.ico"];

  for (const file of icoFiles) {
    it(`${file} carries 16, 24 and 32 px PNG entries`, () => {
      const ico = readFileSync(resolve(RESOURCES, file));
      expect(ico.readUInt16LE(0)).toBe(0);
      expect(ico.readUInt16LE(2)).toBe(1);
      const count = ico.readUInt16LE(4);
      const sizes: number[] = [];
      for (let i = 0; i < count; i++) {
        const entry = 6 + i * 16;
        sizes.push(ico.readUInt8(entry));
        const offset = ico.readUInt32LE(entry + 12);
        expect(ico.subarray(offset + 1, offset + 4).toString("ascii")).toBe("PNG");
      }
      expect(sizes).toEqual([16, 24, 32]);
    });
  }
});
