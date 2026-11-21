import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_MODE_ARG, readAdminModeArg } from "@shared/admin-mode";
import { launchAdminMode, setLaunchAdminMode } from "./admin-mode";
import { setActiveFlagOverrides, withFlagOverrides } from "./flag-overrides";

afterEach(() => {
  setLaunchAdminMode(false);
  setActiveFlagOverrides({});
});

describe("launch mode set marker", () => {
  it("is false until setLaunchAdminMode runs, so a second launch cannot open a window earlier", async () => {
    vi.resetModules();
    const fresh = await import("./admin-mode");
    expect(fresh.isLaunchAdminModeSet()).toBe(false);
    fresh.setLaunchAdminMode(false);
    expect(fresh.isLaunchAdminModeSet()).toBe(true);
  });
});

describe("withFlagOverrides carries the launch mode to a window", () => {
  it("adds the Admin launch argument next to the window's own arguments", () => {
    setLaunchAdminMode(true);
    const prefs = withFlagOverrides({ additionalArguments: ["--mine"] });
    expect(prefs.additionalArguments).toContain("--mine");
    expect(readAdminModeArg(prefs.additionalArguments ?? [])).toBe(true);
  });

  it("adds it together with the flag overrides", () => {
    setLaunchAdminMode(true);
    setActiveFlagOverrides({ "image-canvas": false });
    const args = withFlagOverrides({}).additionalArguments ?? [];
    expect(args.some((a) => a.startsWith("--kaipu-flag-overrides="))).toBe(true);
    expect(readAdminModeArg(args)).toBe(true);
  });

  it("User mode adds nothing: the preferences come back untouched", () => {
    const prefs = { sandbox: true };
    expect(withFlagOverrides(prefs)).toBe(prefs);
    expect((withFlagOverrides({}).additionalArguments ?? []).join(" ")).not.toContain(
      ADMIN_MODE_ARG,
    );
  });

  it("reads the value set at launch", () => {
    expect(launchAdminMode()).toBe(false);
    setLaunchAdminMode(true);
    expect(launchAdminMode()).toBe(true);
  });
});

describe("every renderer window takes the launch mode (AC8)", () => {
  // A window that builds its own webPreferences without `withFlagOverrides` would open in User
  // mode while main and the others run Admin: the badge and the behavior would disagree.
  // Exempt: the diagnostic window loads no renderer (no preload), and flag-overrides.ts is where
  // `withFlagOverrides` itself is defined.
  const EXEMPT = new Set([join("diagnostics", "cursor-capture.ts"), "flag-overrides.ts"]);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
    });
  }

  it("builds the webPreferences of every window through withFlagOverrides", () => {
    const root = __dirname;
    const offenders = sourceFiles(root)
      .filter((file) => !EXEMPT.has(relative(root, file)))
      .filter((file) => /webPreferences\s*:/.test(readFileSync(file, "utf8")))
      .filter((file) => !/webPreferences:\s*withFlagOverrides\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
