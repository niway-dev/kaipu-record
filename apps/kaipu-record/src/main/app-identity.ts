import { join } from "path";

/**
 * The name an unpackaged run (`bun run dev`) goes by. Electron derives the app name from
 * package.json, which the installed app and a dev run share — so without this both used one
 * userData directory: one single-instance lock (whichever started second quit at once), one
 * `auth.enc` (a dev-server session in the production app, and the reverse), one onboarding
 * state, one device id. The name is set on every launch before `ready`, so whichever keychain
 * entry `safeStorage` derives from it is the same each time and a dev sign-in survives restarts.
 */
export const DEV_APP_NAME = "kaipu-record-dev";

export interface AppIdentity {
  name: string;
  /** Null when the caller already chose the directory with `--user-data-dir`. */
  userDataDir: string | null;
}

/**
 * The identity a run should take on before anything reads userData, or null to keep
 * Electron's default (a packaged build: the installed app keeps the directory it always had).
 * Pure, so the decision is testable without Electron.
 */
export function devAppIdentity(options: {
  isPackaged: boolean;
  /** `--user-data-dir` on the command line: the E2E suite's throwaway directory wins. */
  hasUserDataDirSwitch: boolean;
  /** `app.getPath("appData")`. */
  appDataDir: string;
}): AppIdentity | null {
  if (options.isPackaged) return null;
  return {
    name: DEV_APP_NAME,
    userDataDir: options.hasUserDataDirSwitch ? null : join(options.appDataDir, DEV_APP_NAME),
  };
}
