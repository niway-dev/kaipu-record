import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeId, isInside, isSafeId, resolveInside } from "./safe-path";

describe("isSafeId", () => {
  it.each([
    "recording-2026-10-12-10-00-00",
    "screenshot-2026-10-12T10-00-00-000Z",
    "session-12",
    "3f2b8c1e-8a4d-4c1e-9d27-5a0b6f1e2c3d",
    "My clip (1)",
    "Grabación 2026",
    "a.b",
  ])("accepts %s", (id) => {
    expect(isSafeId(id)).toBe(true);
  });

  it.each([
    "",
    ".",
    "..",
    "../etc/passwd",
    "..\\windows",
    "a/b",
    "a\\b",
    "a/../b",
    "a..b",
    ".kaipu",
    ".hidden",
    "/abs",
    "C:\\x",
    "a\0b",
    "a\nb",
    " leading",
    "x".repeat(201),
    "%2e%2e%2fsecret",
  ])("rejects %j", (id) => {
    expect(isSafeId(id)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isSafeId(undefined)).toBe(false);
    expect(isSafeId(null)).toBe(false);
    expect(isSafeId(42)).toBe(false);
    expect(isSafeId({ toString: () => "ok" })).toBe(false);
    expect(isSafeId(["ok"])).toBe(false);
  });

  it("assertSafeId throws with the label", () => {
    expect(() => assertSafeId("../x", "session id")).toThrow("Invalid session id");
    expect(() => assertSafeId("fine")).not.toThrow();
  });
});

describe("resolveInside", () => {
  const root = join(sep, "vault");

  it("resolves a child path", () => {
    expect(resolveInside(root, "a.mp4")).toBe(join(root, "a.mp4"));
    expect(resolveInside(root, ".kaipu", "a.json")).toBe(join(root, ".kaipu", "a.json"));
  });

  it("rejects traversal out of the root", () => {
    expect(() => resolveInside(root, "..", "etc", "passwd")).toThrow();
    expect(() => resolveInside(root, "../../etc/passwd")).toThrow();
    expect(() => resolveInside(root, "a", "..", "..", "b")).toThrow();
  });

  it("rejects a sibling directory that shares the root's prefix", () => {
    expect(() => resolveInside(root, "..", "vault-evil", "x")).toThrow();
    expect(isInside(root, join(sep, "vault-evil", "x"))).toBe(false);
  });

  it("rejects the root itself and absolute escapes", () => {
    expect(() => resolveInside(root, ".")).toThrow();
    expect(() => resolveInside(root, join(sep, "etc", "passwd"))).toThrow();
  });
});
