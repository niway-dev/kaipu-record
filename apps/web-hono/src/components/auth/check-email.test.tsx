import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const mocks = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(async () => ({ data: { status: true }, error: null })),
  signOut: vi.fn(async () => ({})),
}));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { sendVerificationEmail: mocks.sendVerificationEmail, signOut: mocks.signOut },
}));

import { CheckEmail, formatCountdown, RESEND_COOLDOWN_S } from "./check-email";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.sendVerificationEmail.mockClear();
  mocks.signOut.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("CheckEmail", () => {
  it("says where the link went and what it is for", () => {
    renderWithProviders(<CheckEmail email="ada@example.com" onChangeEmail={() => {}} />);
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText(/Open it to activate Kaipu Cloud/)).toBeTruthy();
    // No Gmail shortcut for an address that is not Gmail.
    expect(screen.queryByRole("link", { name: "Open Gmail" })).toBeNull();
  });

  it("holds Resend until the cooldown ends, then sends the same link email again", async () => {
    renderWithProviders(<CheckEmail email="ada@example.com" onChangeEmail={() => {}} />);
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(screen.getByText(/available in 1:00/)).toBeTruthy();
    await advance(18_000);
    expect(screen.getByText(/available in 0:42/)).toBeTruthy();

    await advance((RESEND_COOLDOWN_S - 18) * 1000);
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await advance(0);
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: "/auth/email-verified",
    });
    expect(screen.getByText("Sent again. Check your inbox.")).toBeTruthy();
    // The countdown starts over, so a double press cannot send two.
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("Change it signs out before handing back to the form", async () => {
    const onChangeEmail = vi.fn();
    renderWithProviders(<CheckEmail email="ada@example.com" onChangeEmail={onChangeEmail} />);
    fireEvent.click(screen.getByRole("button", { name: "Wrong email? Change it" }));
    await advance(0);
    expect(mocks.signOut).toHaveBeenCalled();
    expect(onChangeEmail).toHaveBeenCalled();
  });

  it("formats the countdown like the design", () => {
    expect(formatCountdown(42)).toBe("0:42");
    expect(formatCountdown(60)).toBe("1:00");
  });

  it("speaks Spanish", () => {
    renderWithProviders(<CheckEmail email="ada@example.com" onChangeEmail={() => {}} />, "es");
    expect(screen.getByRole("heading", { name: "Revisa tu correo" })).toBeTruthy();
  });
});
