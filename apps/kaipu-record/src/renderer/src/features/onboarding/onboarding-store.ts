/**
 * First-run persistence for onboarding, kept in `localStorage` (MVP — no
 * main-process settings store yet). All access is wrapped in try/catch because
 * localStorage can throw in restricted/SSR-like renderer contexts.
 */

const STORAGE_KEY = "kaipu.onboarding.completed";

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Ignore — onboarding will simply show again next launch.
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
