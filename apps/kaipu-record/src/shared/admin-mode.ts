/**
 * Admin mode (ADR 0067), the pure rules. In `src/shared`, so the preload bundle loads it: no
 * value import from a workspace package (CLAUDE.md preload rule). `admin-mode.test.ts` pins the
 * wire fields against the domain schema, which tests may import.
 */

/** Process argument main hands every renderer window; the preload reads it back. */
export const ADMIN_MODE_ARG = "--kaipu-admin-mode=";

/** What the stored session says about the account; `null` means signed out. */
export interface AdminSession {
  admin: boolean;
}

/**
 * The mode the app runs in: Admin only when signed in, the account holds the admin permission
 * AND the preference is on. The preference alone grants nothing: `settings.json` can be edited by
 * hand. Main computes this once at launch and the result is fixed for the process.
 */
export function computeAdminMode(input: {
  adminModeSetting: boolean;
  session: AdminSession | null;
}): boolean {
  return input.session !== null && input.session.admin === true && input.adminModeSetting === true;
}

/**
 * Whether an entitlements answer grants the admin permission to the session that is current NOW.
 * An answer that names another user (or none), or that is not `admin: true` (an older server
 * sends no `admin`), grants nothing.
 */
export function adminAnswerFor(
  answer: { userId?: unknown; admin?: unknown },
  sessionUserId: string | null | undefined,
): boolean {
  return (
    answer.admin === true &&
    typeof answer.userId === "string" &&
    typeof sessionUserId === "string" &&
    answer.userId === sessionUserId
  );
}

/** The process argument that carries the launch mode to a renderer. */
export function adminModeArg(effective: boolean): string {
  return `${ADMIN_MODE_ARG}${effective ? "1" : "0"}`;
}

/** Read the launch mode back from `process.argv` (preload side); false when absent or malformed. */
export function readAdminModeArg(argv: readonly string[]): boolean {
  const arg = argv.find((entry) => entry.startsWith(ADMIN_MODE_ARG));
  return arg !== undefined && arg.slice(ADMIN_MODE_ARG.length) === "1";
}

/** What the UI reads (Settings row, restart prompt): see `adminModeState`. */
export interface AdminModeState {
  /** The stored permission right now (false when signed out). */
  isAdmin: boolean;
  /** The preference in settings. */
  adminModeSetting: boolean;
  /** The mode this process runs in: fixed at launch, never changes while it runs. */
  effective: boolean;
  /** A relaunch would run in a different mode than this process does. */
  restartPending: boolean;
}

export function adminModeState(input: {
  effective: boolean;
  adminModeSetting: boolean;
  session: AdminSession | null;
}): AdminModeState {
  const next = computeAdminMode({
    adminModeSetting: input.adminModeSetting,
    session: input.session,
  });
  return {
    isAdmin: input.session?.admin === true,
    adminModeSetting: input.adminModeSetting,
    effective: input.effective,
    restartPending: input.effective !== next,
  };
}
