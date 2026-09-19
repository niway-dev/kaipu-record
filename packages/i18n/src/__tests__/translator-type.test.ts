import { describe, it, expect } from "vitest";
import type { Translator } from "../index";

/**
 * A type-level regression test. The assertions that matter here are the
 * `@ts-expect-error` lines: they fail the type check if `Translator` ever stops
 * scoping keys to its namespace — which is the whole reason it exists. A translator
 * typed over the entire catalog is what produced TS2589 once the catalog grew a level
 * deeper, so widening this type must break loudly rather than compile and wait.
 */
describe("Translator<N>", () => {
  const t = ((key: string) => key) as unknown as Translator<"routeError">;

  it("accepts a key from its own namespace", () => {
    expect(t("notFound")).toBe("notFound");
  });

  it("rejects a key from another namespace", () => {
    // @ts-expect-error — `ageMinutes` lives in `storageCloud`, not `routeError`.
    expect(t("ageMinutes")).toBe("ageMinutes");
  });

  it("rejects a key that exists nowhere", () => {
    // @ts-expect-error — not a key in any namespace.
    expect(t("thisKeyDoesNotExist")).toBe("thisKeyDoesNotExist");
  });
});
