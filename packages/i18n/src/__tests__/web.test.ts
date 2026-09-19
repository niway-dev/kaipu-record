import { describe, it, expect } from "vitest";
import { detectLocaleFromRequest } from "../web";
import { normalizeLocale } from "../config";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://kaipu.app", { headers });
}

describe("normalizeLocale", () => {
  it("maps a region locale to its base", () => {
    expect(normalizeLocale("es-419")).toBe("es");
    expect(normalizeLocale("en-US")).toBe("en");
  });

  it("falls back to the default for unsupported or empty input", () => {
    expect(normalizeLocale("fr")).toBe("en");
    expect(normalizeLocale("")).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
  });
});

describe("detectLocaleFromRequest", () => {
  it("prefers a valid cookie over Accept-Language", () => {
    const req = requestWith({
      cookie: "KAIPU_LOCALE=en; other=1",
      "accept-language": "es-ES,es;q=0.9",
    });
    expect(detectLocaleFromRequest(req)).toBe("en");
  });

  it("falls back to the primary Accept-Language subtag", () => {
    const req = requestWith({ "accept-language": "en-US,en;q=0.9" });
    expect(detectLocaleFromRequest(req)).toBe("en");
  });

  it("defaults to en when nothing matches", () => {
    expect(detectLocaleFromRequest(requestWith({}))).toBe("en");
    expect(detectLocaleFromRequest(requestWith({ "accept-language": "fr-FR" }))).toBe("en");
  });

  it("still honours an explicit Spanish preference", () => {
    expect(detectLocaleFromRequest(requestWith({ "accept-language": "es-PE,es;q=0.9" }))).toBe(
      "es",
    );
    expect(detectLocaleFromRequest(requestWith({ cookie: "KAIPU_LOCALE=es" }))).toBe("es");
  });
});
