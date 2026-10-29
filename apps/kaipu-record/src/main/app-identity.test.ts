import { join } from "path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { DEV_APP_NAME, devAppIdentity } from "./app-identity";

const APP_DATA = "/Users/someone/Library/Application Support";
// Electron names the installed app's data directory after package.json: `productName` when it
// has one, `name` otherwise. That directory also holds the single-instance lock.
const PACKAGED_USER_DATA = join(
  APP_DATA,
  (packageJson as { productName?: string }).productName ?? packageJson.name,
);

describe("devAppIdentity", () => {
  it("leaves a packaged build alone", () => {
    expect(
      devAppIdentity({ isPackaged: true, hasUserDataDirSwitch: false, appDataDir: APP_DATA }),
    ).toBeNull();
  });

  it("gives an unpackaged run its own data directory, apart from the installed app's", () => {
    const identity = devAppIdentity({
      isPackaged: false,
      hasUserDataDirSwitch: false,
      appDataDir: APP_DATA,
    });
    expect(identity?.userDataDir).toBe(join(APP_DATA, DEV_APP_NAME));
    expect(identity?.userDataDir).not.toBe(PACKAGED_USER_DATA);
  });

  it("gives an unpackaged run its own name, so its keychain entry is its own too", () => {
    const identity = devAppIdentity({
      isPackaged: false,
      hasUserDataDirSwitch: false,
      appDataDir: APP_DATA,
    });
    expect(identity?.name).toBe(DEV_APP_NAME);
    expect(identity?.name).not.toBe(packageJson.name);
  });

  it("keeps an explicit --user-data-dir (the E2E suite's throwaway directory)", () => {
    const identity = devAppIdentity({
      isPackaged: false,
      hasUserDataDirSwitch: true,
      appDataDir: APP_DATA,
    });
    expect(identity?.userDataDir).toBeNull();
  });
});
