import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import {
  ENTITLEMENTS_FREE,
  USER_UNVERIFIED,
  USER_VERIFIED,
  envelope,
} from "@/test/fixtures/account";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/first-visit";

const mocks = vi.hoisted(() => ({ storage: vi.fn(), entitlements: vi.fn() }));
vi.mock("@/lib/orpc-client", () => ({
  client: { me: { storage: mocks.storage, entitlements: mocks.entitlements } },
  orpc: {},
}));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { sendVerificationEmail: vi.fn(), getSession: vi.fn() },
}));

import { WelcomeSection, displayName } from "./welcome-section";

const onSessionChanged = async () => undefined;

beforeEach(() => {
  window.localStorage.clear();
  mocks.storage.mockReset();
  mocks.entitlements.mockReset();
  mocks.storage.mockReturnValue(new Promise(() => undefined));
  mocks.entitlements.mockResolvedValue(envelope(ENTITLEMENTS_FREE));
});
afterEach(cleanup);

describe("displayName", () => {
  it("uses the name, trimmed", () => {
    expect(displayName({ name: "  Ada Lovelace ", email: "ada@example.com" })).toBe("Ada Lovelace");
  });

  it("falls back to the part of the email before the @", () => {
    expect(displayName({ name: "", email: "ada@example.com" })).toBe("ada");
    expect(displayName({ name: "   ", email: "grace@example.com" })).toBe("grace");
  });
});

describe("WelcomeSection", () => {
  it("greets the user by name and shows the email", () => {
    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.getByRole("heading", { name: "Hi, Ada Lovelace" })).toBeTruthy();
    expect(screen.getByText("Signed in as ada@example.com")).toBeTruthy();
  });

  it("greets a user with no name by the start of their email", () => {
    renderWithProviders(
      <WelcomeSection user={{ ...USER_VERIFIED, name: "" }} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.getByRole("heading", { name: "Hi, ada" })).toBeTruthy();
  });

  it("says nothing about verification for a verified user", () => {
    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.queryByRole("button", { name: "Resend verification email" })).toBeNull();
  });

  it("explains that cloud is locked and offers the resend for an unverified user", () => {
    renderWithProviders(
      <WelcomeSection user={USER_UNVERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.getByText(/Cloud is locked until you verify your email/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend verification email" })).toBeTruthy();
  });

  it("welcomes a first visit with the plan, once", async () => {
    const first = renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(await screen.findByText("Your account is ready")).toBeTruthy();
    expect(await screen.findByText(/You're on the Free plan/)).toBeTruthy();
    expect(hasSeenWelcome(USER_VERIFIED.id)).toBe(true);
    first.unmount();

    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: /Hi,/ })).toBeTruthy());
    expect(screen.queryByText("Your account is ready")).toBeNull();
  });

  it("does not welcome a user this browser has already welcomed", () => {
    markWelcomeSeen(USER_VERIFIED.id);
    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.queryByText("Your account is ready")).toBeNull();
  });

  it("keeps the welcome per user", async () => {
    markWelcomeSeen("someone-else");
    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(await screen.findByText("Your account is ready")).toBeTruthy();
  });

  it("still welcomes when the plan could not be read, without naming one", async () => {
    mocks.entitlements.mockRejectedValue(new Error("down"));
    renderWithProviders(
      <WelcomeSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(await screen.findByText("Your account is ready")).toBeTruthy();
    expect(screen.queryByText(/plan\./)).toBeNull();
  });
});
