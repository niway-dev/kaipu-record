import { describe, expect, it } from "vitest";
import { isConsoleAdmin } from "./access";
describe("console operator authorization", () => {
  it("denies missing identity and empty configuration", () => {
    expect(isConsoleAdmin(undefined, "owner")).toBe(false);
    expect(isConsoleAdmin("owner", " , ")).toBe(false);
  });
  it("accepts only complete IDs, never substrings or emails", () => {
    expect(isConsoleAdmin("owner", " owner,backup ")).toBe(true);
    expect(isConsoleAdmin("own", "owner")).toBe(false);
    expect(isConsoleAdmin("other", "owner")).toBe(false);
    expect(isConsoleAdmin("OWNER", "owner")).toBe(false);
  });
});
