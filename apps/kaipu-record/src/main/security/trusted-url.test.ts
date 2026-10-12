import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isTrustedAppUrl, type TrustedOrigin } from "./trusted-url";

const entry = "/Applications/Kaipu Record.app/Contents/Resources/app.asar/out/renderer/index.html";
const packaged: TrustedOrigin = { rendererFilePath: entry };
const dev: TrustedOrigin = { rendererFilePath: entry, devOrigin: "http://localhost:5173/" };

describe("isTrustedAppUrl", () => {
  it("accepts the packaged renderer entry, with or without query and hash", () => {
    const base = pathToFileURL(entry).href;
    expect(isTrustedAppUrl(base, packaged)).toBe(true);
    expect(isTrustedAppUrl(`${base}?mode=capture`, packaged)).toBe(true);
    expect(isTrustedAppUrl(`${base}?window=control-bar#/x`, packaged)).toBe(true);
  });

  it("rejects other local files", () => {
    expect(isTrustedAppUrl("file:///etc/passwd", packaged)).toBe(false);
    expect(isTrustedAppUrl(pathToFileURL(`${entry}.evil.html`).href, packaged)).toBe(false);
    expect(isTrustedAppUrl("file:///tmp/evil/index.html", packaged)).toBe(false);
  });

  it("rejects remote and opaque origins", () => {
    expect(isTrustedAppUrl("https://example.com/", packaged)).toBe(false);
    expect(isTrustedAppUrl("https://kaipu.app/index.html", packaged)).toBe(false);
    expect(isTrustedAppUrl("kaipu-media://recording/x", packaged)).toBe(false);
    expect(isTrustedAppUrl("about:blank", packaged)).toBe(false);
    expect(isTrustedAppUrl("data:text/html,hi", packaged)).toBe(false);
    expect(isTrustedAppUrl("javascript:alert(1)", packaged)).toBe(false);
  });

  it("rejects empty and malformed input", () => {
    expect(isTrustedAppUrl("", packaged)).toBe(false);
    expect(isTrustedAppUrl(undefined, packaged)).toBe(false);
    expect(isTrustedAppUrl(null, packaged)).toBe(false);
    expect(isTrustedAppUrl("not a url", packaged)).toBe(false);
  });

  it("accepts the dev server origin only when configured", () => {
    expect(isTrustedAppUrl("http://localhost:5173/?mode=capture", dev)).toBe(true);
    expect(isTrustedAppUrl("http://localhost:5173/", packaged)).toBe(false);
    expect(isTrustedAppUrl("http://localhost:9999/", dev)).toBe(false);
    expect(isTrustedAppUrl("http://localhost.evil.com:5173/", dev)).toBe(false);
  });
});
