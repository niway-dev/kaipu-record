import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { USER_UNVERIFIED, USER_VERIFIED } from "@/test/fixtures/account";
import { RESEND_COOLDOWN_MS, readResendSentAt, writeResendSentAt } from "@/lib/resend-cooldown";

const auth = vi.hoisted(() => ({
  updateUser: vi.fn(),
  sendVerificationEmail: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/auth/auth-client", () => ({ authClient: auth }));

import { ProfileSection } from "./profile-section";

const onSessionChanged = vi.fn(async () => undefined);

beforeEach(() => {
  window.localStorage.clear();
  onSessionChanged.mockClear();
  for (const fn of Object.values(auth)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ProfileSection", () => {
  it("shows the name, the email and the verification badge", () => {
    renderWithProviders(
      <ProfileSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ada Lovelace");
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend verification email" })).toBeNull();
  });

  it("saves a trimmed name and refreshes what depends on the session", async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    renderWithProviders(
      <ProfileSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Ada King  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("Name updated")).toBeTruthy();
    expect(auth.updateUser).toHaveBeenCalledWith({ name: "Ada King" });
    expect(onSessionChanged).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty or over-long name before calling the API", async () => {
    renderWithProviders(
      <ProfileSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Use between 1 and 80 characters.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Use between 1 and 80 characters.")).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("shows an error when the name cannot be saved", async () => {
    auth.updateUser.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderWithProviders(
      <ProfileSection user={USER_VERIFIED} onSessionChanged={onSessionChanged} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada King" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("We couldn't update your name. Try again.")).toBeTruthy();
    expect(onSessionChanged).not.toHaveBeenCalled();
  });

  it("explains why cloud is locked and resends with a two-minute cooldown", async () => {
    auth.sendVerificationEmail.mockResolvedValue({ data: {}, error: null });
    renderWithProviders(
      <ProfileSection user={USER_UNVERIFIED} onSessionChanged={onSessionChanged} />,
    );
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.getByText(/Cloud is locked until you verify your email/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    const resend = screen.getByRole("button", { name: "Resend verification email" });
    fireEvent.click(resend);

    await waitFor(() => expect((resend as HTMLButtonElement).disabled).toBe(true));
    expect(auth.sendVerificationEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: "/auth/email-verified",
    });
    expect(screen.getByText(/Verification email sent/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(readResendSentAt(USER_UNVERIFIED.id)).not.toBeNull();
  });

  it("re-enables resend once the cooldown has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    auth.sendVerificationEmail.mockResolvedValue({ data: {}, error: null });
    renderWithProviders(
      <ProfileSection user={USER_UNVERIFIED} onSessionChanged={onSessionChanged} />,
    );
    const resend = screen.getByRole("button", { name: "Resend verification email" });
    await act(async () => {
      fireEvent.click(resend);
    });
    expect((resend as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(RESEND_COOLDOWN_MS + 100);
    });
    expect((resend as HTMLButtonElement).disabled).toBe(false);
  });

  it("stays disabled after a reload, from the stored send time", async () => {
    writeResendSentAt(USER_UNVERIFIED.id, Date.now() - 30_000);
    renderWithProviders(
      <ProfileSection user={USER_UNVERIFIED} onSessionChanged={onSessionChanged} />,
    );
    const resend = screen.getByRole("button", { name: "Resend verification email" });
    await waitFor(() => expect((resend as HTMLButtonElement).disabled).toBe(true));
  });

  it("shows a visible error on a failed resend and leaves the button usable", async () => {
    auth.sendVerificationEmail.mockResolvedValue({ data: null, error: { message: "smtp" } });
    renderWithProviders(
      <ProfileSection user={USER_UNVERIFIED} onSessionChanged={onSessionChanged} />,
    );
    const resend = screen.getByRole("button", { name: "Resend verification email" });
    fireEvent.click(resend);

    expect(await screen.findByText(/verification email could not be sent/)).toBeTruthy();
    expect((resend as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(readResendSentAt(USER_UNVERIFIED.id)).toBeNull();
  });

  it("refreshes past the cookie cache after a successful resend", async () => {
    writeResendSentAt(USER_UNVERIFIED.id, Date.now() - 1_000);
    auth.getSession.mockResolvedValue({ data: {}, error: null });
    renderWithProviders(
      <ProfileSection user={USER_UNVERIFIED} onSessionChanged={onSessionChanged} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledTimes(1));
    expect(auth.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
  });
});
