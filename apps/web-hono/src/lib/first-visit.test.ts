import { describe, expect, it } from "vitest";
import { claimFirstVisit } from "./first-visit";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("claimFirstVisit", () => {
  it("is true once per user, then false", () => {
    const store = memoryStore();
    expect(claimFirstVisit("u1", store)).toBe(true);
    expect(claimFirstVisit("u1", store)).toBe(false);
    expect(claimFirstVisit("u2", store)).toBe(true);
  });

  it("is false, without throwing, when storage is missing or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(claimFirstVisit("u1", null)).toBe(false);
    expect(claimFirstVisit("u1", throwing)).toBe(false);
    const quotaFull = { getItem: () => null, setItem: throwing.setItem };
    expect(claimFirstVisit("u1", quotaFull)).toBe(false);
  });
});
