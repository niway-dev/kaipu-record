import { describe, expect, it } from "vitest";

import { hasSeenWelcome, markWelcomeSeen } from "./first-visit";

function memoryStore(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("first-visit welcome", () => {
  it("is unseen until it is marked, per user", () => {
    const store = memoryStore();
    expect(hasSeenWelcome("user-1", store)).toBe(false);
    markWelcomeSeen("user-1", store);
    expect(hasSeenWelcome("user-1", store)).toBe(true);
    expect(hasSeenWelcome("user-2", store)).toBe(false);
  });

  it("counts as seen when storage is missing or throws", () => {
    expect(hasSeenWelcome("user-1", null)).toBe(true);
    expect(hasSeenWelcome("user-1", throwing)).toBe(true);
    expect(() => markWelcomeSeen("user-1", throwing)).not.toThrow();
    expect(() => markWelcomeSeen("user-1", null)).not.toThrow();
  });
});
