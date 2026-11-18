/**
 * First-run persistence for onboarding, kept in `localStorage` (MVP — no
 * main-process settings store yet). All access is wrapped in try/catch because
 * localStorage can throw in restricted/SSR-like renderer contexts.
 */

const STORAGE_KEY = "kaipu.onboarding.completed";
/**
 * Set once the privacy step has been on screen, in the flow or as the notice. Separate from
 * completion on purpose: people who finished onboarding before the step existed have one and
 * not the other, and are shown the step once, as a notice (NIW2-849).
 */
const PRIVACY_KEY = "kaipu.onboarding.privacySeen";

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

export function hasSeenPrivacyNotice(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === "true";
  } catch {
    // Unreadable storage: do not nag on every launch.
    return true;
  }
}

export function markPrivacySeen(): void {
  try {
    localStorage.setItem(PRIVACY_KEY, "true");
  } catch {
    // Ignore — the notice will simply show again next launch.
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
