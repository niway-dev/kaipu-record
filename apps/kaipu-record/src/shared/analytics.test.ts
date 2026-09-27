import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT,
  DEFAULT_SURFACE,
  FLAG_DEFAULTS,
  FLAG_NAMES,
  serializeError,
} from "./analytics";

describe("flag model", () => {
  it("defaults every known flag to a safe value", () => {
    for (const name of FLAG_NAMES) {
      expect(typeof FLAG_DEFAULTS[name]).toBe("boolean");
    }
    // Login is bypassed pre-auth.
    expect(FLAG_DEFAULTS["bypass-login"]).toBe(true);
  });

  it("uses stable identity defaults", () => {
    expect(DEFAULT_PRODUCT).toBe("kaipu-recorder");
    expect(DEFAULT_SURFACE).toBe("desktop");
  });
});

describe("serializeError", () => {
  it("extracts name/message/stack from an Error", () => {
    const payload = serializeError(new TypeError("boom"));
    expect(payload.name).toBe("TypeError");
    expect(payload.message).toBe("boom");
    expect(payload.stack).toContain("boom");
  });

  it("survives non-Error throws", () => {
    expect(serializeError("nope")).toEqual({ name: "Error", message: "nope", stack: null });
    expect(serializeError(undefined).message).toBe("Unknown error");
  });
});
