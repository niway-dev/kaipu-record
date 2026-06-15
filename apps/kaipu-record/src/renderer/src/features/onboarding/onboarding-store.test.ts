import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasCompletedOnboarding,
  markOnboardingComplete,
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
});
