import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import type { AuthSession } from "@/lib/auth/types";

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
import { desktopCallbackUrl } from "@/lib/desktop-auth";

// What the plugin's cookie holds: base64url of {"identifier":"<32 chars>","state":"<state>"}.
const COOKIE_VALUE = Buffer.from(
  JSON.stringify({ identifier: "a".repeat(32), state: "Ab12Cd34Ef56Gh78" }),
).toString("base64url");
const session = {
  user: { name: "Ada Lovelace", email: "ada@example.com" },
  session: {},
} as unknown as AuthSession;

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
    renderWithProviders(<DesktopDonePage session={session} />);
    expect(screen.getByRole("heading", { name: "Returning to Kaipu…" })).toBeTruthy();
    await advance(CODE_POLL_INTERVAL_MS);
    expect(mocks.ensureElectronRedirect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "You're signed in" })).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Kaipu Record" })).toBeTruthy();
    expect(screen.getByText("You can close this tab after the app opens.")).toBeTruthy();
    // The paste-the-code fallback waits, as before, so it does not compete with the app opening.
    expect(screen.queryByLabelText("Sign-in code")).toBeNull();
  });

  it("Open Kaipu Record opens the same deep link ensureElectronRedirect used", async () => {
    renderWithProviders(<DesktopDonePage session={session} />);
    await advance(CODE_POLL_INTERVAL_MS);
    const original = window.location;
    const location = { href: "" };
    Object.defineProperty(window, "location", { value: location, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "Open Kaipu Record" }));
    expect(location.href).toBe(desktopCallbackUrl(COOKIE_VALUE));
    Object.defineProperty(window, "location", { value: original, configurable: true });
  });

  it("keeps the copy-the-code fallback below, with the cookie value, not the raw code", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderWithProviders(<DesktopDonePage session={session} />);
    await advance(CODE_POLL_INTERVAL_MS + FALLBACK_AFTER_MS);

    // The primary action stays; the fallback is added under it.
    expect(screen.getByRole("button", { name: "Open Kaipu Record" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Kaipu didn't open?" })).toBeTruthy();
    expect((screen.getByLabelText("Sign-in code") as HTMLTextAreaElement).value).toBe(COOKIE_VALUE);

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await advance(0);
    // The desktop's authenticate({ token }) base64url-decodes this value into {identifier, state}.
    expect(writeText).toHaveBeenCalledWith(COOKIE_VALUE);
    expect(JSON.parse(Buffer.from(COOKIE_VALUE, "base64url").toString())).toHaveProperty("state");
    expect(screen.getByText("Code copied. Paste it in the Kaipu app.")).toBeTruthy();
  });

  it("after an email sign-up, also says to check the email without holding the app back", async () => {
    renderWithProviders(<DesktopDonePage session={session} checkEmail />);
    await advance(CODE_POLL_INTERVAL_MS);
    expect(screen.getByText("Check your email")).toBeTruthy();
    expect(screen.getByText(/Open it to activate Kaipu Cloud/)).toBeTruthy();
    expect(mocks.ensureElectronRedirect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Open Kaipu Record" })).toBeTruthy();
  });

  it("speaks Spanish", async () => {
    renderWithProviders(<DesktopDonePage session={session} />, "es");
    await advance(CODE_POLL_INTERVAL_MS);
    expect(screen.getByRole("button", { name: "Abrir Kaipu Record" })).toBeTruthy();
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
