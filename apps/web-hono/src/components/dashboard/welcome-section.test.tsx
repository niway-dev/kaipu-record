import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { USER_UNVERIFIED, USER_VERIFIED } from "@/test/fixtures/account";
import { readResendSentAt } from "@/lib/resend-cooldown";

const auth = vi.hoisted(() => ({ sendVerificationEmail: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/auth/auth-client", () => ({ authClient: auth }));

import { WelcomeSection, greetingName } from "./welcome-section";

const onSessionChanged = vi.fn(async () => undefined);

beforeEach(() => {
  window.localStorage.clear();
  onSessionChanged.mockClear();
  for (const fn of Object.values(auth)) fn.mockReset();
});
afterEach(cleanup);

describe("greetingName", () => {
  it("uses the name, or the email local part when the name is blank", () => {
    expect(greetingName({ name: " Ada ", email: "ada@example.com" })).toBe("Ada");
    expect(greetingName({ name: "", email: "grace.hopper@example.com" })).toBe("grace.hopper");
    expect(greetingName({ name: "   ", email: "x@example.com" })).toBe("x");
  });
});

describe("WelcomeSection", () => {
  it("greets by name and shows the email, with no notice for a verified user", () => {
    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.getByRole("heading", { name: "Hi, Ada Lovelace" })).toBeTruthy();
    expect(screen.getByText("Signed in as ada@example.com")).toBeTruthy();
    expect(screen.getByText("Good to see you.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend verification email" })).toBeNull();
  });

  it("falls back to the email local part when there is no name", () => {
    renderWithProviders(
      <WelcomeSection user={{ ...USER_VERIFIED, name: "" }} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.getByRole("heading", { name: "Hi, ada" })).toBeTruthy();
  });

  it("greets in Spanish", () => {
    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
      "es",
    );
    expect(screen.getByRole("heading", { name: "Hola, Ada Lovelace" })).toBeTruthy();
  });

  it("explains that cloud is locked and resends with a cooldown for an unverified user", async () => {
    auth.sendVerificationEmail.mockResolvedValue({ error: null });
    renderWithProviders(
      <WelcomeSection user={USER_UNVERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.getByText(/Cloud is locked until you verify your email/)).toBeTruthy();
    const resend = screen.getByRole("button", { name: "Resend verification email" });
    fireEvent.click(resend);
    await waitFor(() => expect((resend as HTMLButtonElement).disabled).toBe(true));
    expect(auth.sendVerificationEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: "/auth/email-verified",
    });
    expect(readResendSentAt(USER_UNVERIFIED.id)).not.toBeNull();
  });
});
