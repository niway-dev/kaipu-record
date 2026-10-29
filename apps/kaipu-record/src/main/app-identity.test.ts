import { join } from "path";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { DEV_APP_NAME, devAppIdentity } from "./app-identity";

const APP_DATA = "/Users/someone/Library/Application Support";
// The installed app's data — session, settings, the single-instance lock — lives in
// `<appData>/kaipu-record`: Electron names the directory after package.json's `productName`,
// else its `name`. Hard-coded, not derived, so a rename here cannot move users' data silently.
const PACKAGED_USER_DATA = join(APP_DATA, "kaipu-record");

describe("devAppIdentity", () => {
  it("the installed app's data directory name is pinned by package.json", () => {
    expect(packageJson.name).toBe("kaipu-record");
    expect((packageJson as { productName?: string }).productName).toBeUndefined();
  });

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
