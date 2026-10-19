import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeepLinkRouter } from "./deep-link-router";
import { secondInstanceAction } from "./window-close-policy";

const LINK = "kaipu:/auth/callback#token=CODE";

function setup() {
  const completeSignIn = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn();
  return { completeSignIn, focus, router: createDeepLinkRouter({ completeSignIn, focus }) };
}

afterEach(() => vi.restoreAllMocks());

describe("createDeepLinkRouter", () => {
  it("cold start: holds a link that arrived before the app was ready, then delivers it once", () => {
    const { router, completeSignIn, focus } = setup();

    // macOS open-url fires before ready; Windows/Linux put it in our own argv.
    router.receive(LINK);
    expect(router.receiveArgv(["C:\\Kaipu\\kaipu-record.exe", LINK])).toBe(true);
    expect(completeSignIn).not.toHaveBeenCalled();

    router.start();

    expect(completeSignIn).toHaveBeenCalledTimes(2);
    expect(completeSignIn).toHaveBeenCalledWith("CODE");
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("running app: delivers a link at once, from open-url or from a second instance's argv", () => {
    const { router, completeSignIn } = setup();
    router.start();

    router.receive(LINK);
    router.receiveArgv(["electron", ".", "--flag", LINK]);

    expect(completeSignIn).toHaveBeenCalledTimes(2);
  });

  it("a normal launch (no link in argv) is not a sign-in", () => {
    const { router, completeSignIn } = setup();
    expect(router.receiveArgv(["/Applications/Kaipu Record.app/Contents/MacOS/Kaipu Record"])).toBe(
      false,
    );
    router.start();
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("routes unknown paths, including the reserved billing link, to a no-op that never logs the URL", () => {
    const { router, completeSignIn, focus } = setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    router.start();

    router.receive("kaipu://billing/refresh");
    router.receive("kaipu:/auth/callback#token=SECRET");
    router.receive("https://example.com/not-ours");

    expect(completeSignIn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toContain("/billing/refresh");
    expect(JSON.stringify(info.mock.calls)).not.toContain("SECRET");
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("a failing sign-in does not escape as an unhandled rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const completeSignIn = vi.fn().mockRejectedValue(new Error("boom"));
    const router = createDeepLinkRouter({ completeSignIn, focus: () => {} });
    router.start();

    router.receive(LINK);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalled();
  });
});

describe("single instance", () => {
  // The app holds exactly one lock and one `second-instance` handler (src/main/index.ts); the
  // link is routed first, then the window decision is the same one every second launch gets.
  it("a link delivered by a second launch is handled, but never shows the window mid-recording", () => {
    const { router, completeSignIn, focus } = setup();
    router.start();

    router.receiveArgv(["kaipu-record.exe", LINK]);
    const action = secondInstanceAction({ ready: true, recording: true });

    expect(completeSignIn).toHaveBeenCalledWith("CODE");
    expect(action).toBe("notify");
    // The router's own focus callback is what index.ts gates on `hub.isActive()`.
    expect(focus).toHaveBeenCalled();
  });

  it("the main process takes one lock: the plugin's setupMain (a second lock + handler) is not wired", () => {
    const sources = ["index.ts", "services/browser-sign-in.ts"].map((file) =>
      readFileSync(join(__dirname, file), "utf8"),
    );
    const code = sources.join("\n").replace(/\/\/.*$/gm, "");
    expect(code.match(/requestSingleInstanceLock\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/setupMain\(/);
  });
});
