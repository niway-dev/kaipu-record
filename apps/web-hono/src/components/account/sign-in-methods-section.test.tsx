import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { ACCOUNT_GOOGLE, ACCOUNT_PASSWORD } from "@/test/fixtures/account";

const auth = vi.hoisted(() => ({ listAccounts: vi.fn(), changePassword: vi.fn() }));
vi.mock("@/lib/auth/auth-client", () => ({ authClient: auth }));

import { SignInMethodsSection } from "./sign-in-methods-section";

beforeEach(() => {
  auth.listAccounts.mockReset();
  auth.changePassword.mockReset();
  auth.listAccounts.mockResolvedValue({ data: [ACCOUNT_PASSWORD, ACCOUNT_GOOGLE], error: null });
});
afterEach(cleanup);

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("SignInMethodsSection", () => {
  it("lists the methods Better Auth reports, with their link dates", async () => {
    renderWithProviders(<SignInMethodsSection />);
    expect(await screen.findByText("Email and password")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("Linked Sep 1, 2026")).toBeTruthy();
    expect(screen.getByText("Linked Sep 15, 2026")).toBeTruthy();
  });

  it("shows an error, not an empty list, when the methods cannot be loaded", async () => {
    auth.listAccounts.mockResolvedValue({ data: null, error: { message: "nope" } });
    renderWithProviders(<SignInMethodsSection />);
    expect(await screen.findByText("We couldn't load your sign-in methods.")).toBeTruthy();
    expect(screen.queryByText("Change password")).toBeNull();
  });

  it("offers no password form to an account without a password", async () => {
    auth.listAccounts.mockResolvedValue({ data: [ACCOUNT_GOOGLE], error: null });
    renderWithProviders(<SignInMethodsSection />);
    expect(await screen.findByText("Google")).toBeTruthy();
    expect(screen.queryByLabelText("Current password")).toBeNull();
  });

  it("changes the password and revokes the other sessions", async () => {
    auth.changePassword.mockResolvedValue({ data: {}, error: null });
    renderWithProviders(<SignInMethodsSection />);
    await screen.findByLabelText("Current password");
    fill("Current password", "old-password");
    fill("New password", "new-password-1");
    fill("Confirm new password", "new-password-1");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password updated")).toBeTruthy();
    expect(auth.changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password-1",
      revokeOtherSessions: true,
    });
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
  });

  it("puts a wrong current password on its field", async () => {
    auth.changePassword.mockResolvedValue({
      data: null,
      error: { code: "INVALID_PASSWORD", message: "Invalid password", status: 400 },
    });
    renderWithProviders(<SignInMethodsSection />);
    await screen.findByLabelText("Current password");
    fill("Current password", "wrong");
    fill("New password", "new-password-1");
    fill("Confirm new password", "new-password-1");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    const message = await screen.findByText("That is not your current password.");
    expect(message.closest("[role='alert']")).not.toBeNull();
    expect(screen.getByLabelText("Current password").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("Password updated")).toBeNull();
  });

  it("validates before calling the API", async () => {
    renderWithProviders(<SignInMethodsSection />);
    await screen.findByLabelText("Current password");
    fill("Current password", "old");
    fill("New password", "short");
    fill("Confirm new password", "different");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Use at least 8 characters.")).toBeTruthy();
    expect(screen.getByText("The passwords do not match.")).toBeTruthy();
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it("shows a generic form error for any other failure", async () => {
    auth.changePassword.mockResolvedValue({ data: null, error: { message: "boom", status: 500 } });
    renderWithProviders(<SignInMethodsSection />);
    await screen.findByLabelText("Current password");
    fill("Current password", "old-password");
    fill("New password", "new-password-1");
    fill("Confirm new password", "new-password-1");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() =>
      expect(screen.getByText("We couldn't update your password. Try again.")).toBeTruthy(),
    );
  });

  it("leaves a slot for the Google controls NIW2-219 adds, empty by default", async () => {
    renderWithProviders(<SignInMethodsSection googleControls={<button>Connect Google</button>} />);
    expect(await screen.findByRole("button", { name: "Connect Google" })).toBeTruthy();
    cleanup();
    renderWithProviders(<SignInMethodsSection />);
    await screen.findByText("Email and password");
    expect(screen.queryByRole("button", { name: "Connect Google" })).toBeNull();
  });
});
