import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const mocks = vi.hoisted(() => ({
  getAuthorizationCode: vi.fn<() => string | null>(),
  ensureElectronRedirect: vi.fn(),
}));

vi.mock("@/lib/auth/desktop-auth-client", () => ({
  desktopAuthClient: {
    electron: { getAuthorizationCode: mocks.getAuthorizationCode },
    ensureElectronRedirect: mocks.ensureElectronRedirect,
  },
}));

import {
  CODE_POLL_INTERVAL_MS,
  CODE_WAIT_MS,
  DesktopDonePage,
  FALLBACK_AFTER_MS,
} from "./desktop-done-page";

// What the plugin's cookie holds: base64url of {"identifier":"<32 chars>","state":"<state>"}.
const COOKIE_VALUE = Buffer.from(
  JSON.stringify({ identifier: "a".repeat(32), state: "Ab12Cd34Ef56Gh78" }),
).toString("base64url");

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getAuthorizationCode.mockReset().mockReturnValue(COOKIE_VALUE);
  mocks.ensureElectronRedirect.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("DesktopDonePage", () => {
  it("returns to the app as soon as the code cookie is there", async () => {
    renderWithProviders(<DesktopDonePage />);
    expect(screen.getByRole("heading", { name: "Returning to Kaipu…" })).toBeTruthy();
    await advance(CODE_POLL_INTERVAL_MS);
    expect(mocks.ensureElectronRedirect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Returning to Kaipu…" })).toBeTruthy();
  });

  it("offers to open the app again or copy the cookie value, not the raw code", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderWithProviders(<DesktopDonePage />);
    await advance(CODE_POLL_INTERVAL_MS + FALLBACK_AFTER_MS);

    expect(screen.getByRole("heading", { name: "Kaipu didn't open?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Kaipu again" })).toBeTruthy();
    expect((screen.getByLabelText("Sign-in code") as HTMLTextAreaElement).value).toBe(COOKIE_VALUE);

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await advance(0);
    // The desktop's authenticate({ token }) base64url-decodes this value into {identifier, state}.
    expect(writeText).toHaveBeenCalledWith(COOKIE_VALUE);
    expect(JSON.parse(Buffer.from(COOKIE_VALUE, "base64url").toString())).toHaveProperty("state");
    expect(screen.getByText("Code copied. Paste it in the Kaipu app.")).toBeTruthy();
  });

  it("waits for a cookie that arrives late", async () => {
    mocks.getAuthorizationCode.mockReturnValueOnce(null).mockReturnValueOnce(null);
    renderWithProviders(<DesktopDonePage />);
    await advance(CODE_POLL_INTERVAL_MS * 2);
    expect(mocks.ensureElectronRedirect).not.toHaveBeenCalled();
    await advance(CODE_POLL_INTERVAL_MS);
    expect(mocks.ensureElectronRedirect).toHaveBeenCalledTimes(1);
  });

  it("says there is no code when none shows up", async () => {
    mocks.getAuthorizationCode.mockReturnValue(null);
    renderWithProviders(<DesktopDonePage />);
    await advance(CODE_WAIT_MS + CODE_POLL_INTERVAL_MS);
    expect(screen.getByRole("heading", { name: "No sign-in code here" })).toBeTruthy();
    expect(mocks.ensureElectronRedirect).not.toHaveBeenCalled();
  });
});
