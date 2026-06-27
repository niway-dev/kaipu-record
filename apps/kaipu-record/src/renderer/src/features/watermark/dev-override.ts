/**
 * DEV-ONLY watermark bypass. Flips the watermark from a Settings toggle (shown
 * only in dev) instead of an env var — easier to reach and test. Stored in
 * localStorage so it survives reloads.
 *
 * Every read is guarded by `import.meta.env.DEV`, which the bundler replaces with
 * a literal `false` in production. So in a prod build this whole branch is
 * dead-code eliminated — and, importantly, a user can't disable the watermark by
 * setting the localStorage key by hand.
 */
const STORAGE_KEY = "kaipu:dev:simulate-paid";

/** In dev, whether we're simulating a paid plan (→ watermark off). Always false in prod. */
export function readDevSimulatePaid(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDevSimulatePaid(simulatePaid: boolean): void {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(STORAGE_KEY, simulatePaid ? "1" : "0");
  } catch {
    /* localStorage unavailable — ignore */
  }
}
