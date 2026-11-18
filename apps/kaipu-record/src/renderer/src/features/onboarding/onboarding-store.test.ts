import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasCompletedOnboarding,
  hasSeenPrivacyNotice,
  markOnboardingComplete,
  markPrivacySeen,
  resetOnboarding,
} from "./onboarding-store";

describe("onboarding-store", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("reports not completed by default", () => {
    expect(hasCompletedOnboarding()).toBe(false);
  });

  it("persists completion and reads it back", () => {
    markOnboardingComplete();
    expect(hasCompletedOnboarding()).toBe(true);
  });

  it("resets completion", () => {
    markOnboardingComplete();
    resetOnboarding();
    expect(hasCompletedOnboarding()).toBe(false);
  });

  it("returns false when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(hasCompletedOnboarding()).toBe(false);
  });

  it("does not throw when persisting fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => markOnboardingComplete()).not.toThrow();
  });

  describe("privacy notice flag", () => {
    it("is unseen by default and persists once marked", () => {
      expect(hasSeenPrivacyNotice()).toBe(false);
      markPrivacySeen();
      expect(hasSeenPrivacyNotice()).toBe(true);
    });

    it("is independent of completion, so people who finished before the step still see it", () => {
      markOnboardingComplete();
      expect(hasSeenPrivacyNotice()).toBe(false);
    });

    it("survives a replay of the onboarding", () => {
      markPrivacySeen();
      resetOnboarding();
      expect(hasSeenPrivacyNotice()).toBe(true);
    });

    it("counts as seen when storage is unreadable, so it never nags on every launch", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(hasSeenPrivacyNotice()).toBe(true);
    });

    it("does not throw when persisting fails", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(() => markPrivacySeen()).not.toThrow();
    });
  });
});
