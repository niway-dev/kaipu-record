import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { ACCOUNT_GOOGLE, ACCOUNT_PASSWORD, orpcError } from "@/test/fixtures/account";

const auth = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  linkSocial: vi.fn(),
  unlinkAccount: vi.fn(),
  changePassword: vi.fn(),
}));
const api = vi.hoisted(() => ({ setPassword: vi.fn() }));
vi.mock("@/lib/auth/auth-client", () => ({ authClient: auth }));
vi.mock("@/lib/orpc-client", () => ({ client: { me: api } }));

import { GoogleSignInControls } from "./google-sign-in-controls";
import { SignInMethodsSection } from "./sign-in-methods-section";

const accounts = (...list: unknown[]) => ({ data: list, error: null });

beforeEach(() => {
  for (const fn of [...Object.values(auth), api.setPassword]) fn.mockReset();
  auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_PASSWORD));
  auth.linkSocial.mockImplementation(() => new Promise(() => {}));
});
afterEach(cleanup);

function renderSection(locale: "en" | "es" = "en") {
  return renderWithProviders(
    <SignInMethodsSection googleControls={<GoogleSignInControls />} />,
    locale,
  );
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("GoogleSignInControls — connect", () => {
  it("connects Google with linkSocial and comes back to the profile", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Connect Google" }));
    expect(auth.linkSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/dashboard/profile",
      errorCallbackURL: "/dashboard/profile",
    });
    expect(await screen.findByRole("button", { name: "Redirecting to Google…" })).toBeTruthy();
  });

  it("says Google is unavailable when the server has no Google provider", async () => {
    auth.linkSocial.mockResolvedValue({
      data: null,
      error: { code: "PROVIDER_NOT_FOUND", status: 404, message: "Provider not found" },
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Connect Google" }));
    expect(
      await screen.findByText(
        "Google sign-in isn't available right now. Use your email and password.",
      ),
    ).toBeTruthy();
  });

  it("says so when the link cannot start", async () => {
    auth.linkSocial.mockResolvedValue({ data: null, error: { message: "nope", status: 500 } });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Connect Google" }));
    expect(
      await screen.findByText("We couldn't connect your Google account. Try again."),
    ).toBeTruthy();
  });
});

describe("GoogleSignInControls — disconnect", () => {
  it("disconnects Google when a password remains", async () => {
    auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_PASSWORD, ACCOUNT_GOOGLE));
    auth.unlinkAccount.mockResolvedValue({ data: { status: true }, error: null });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Google" }));
    expect(await screen.findByText("Google disconnected")).toBeTruthy();
    expect(auth.unlinkAccount).toHaveBeenCalledWith({ accountId: ACCOUNT_GOOGLE.id });
    await waitFor(() => expect(auth.listAccounts).toHaveBeenCalledTimes(2));
  });

  it("disables disconnecting the last method and explains why", async () => {
    auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_GOOGLE));
    renderSection();
    const button = await screen.findByRole("button", { name: "Disconnect Google" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "Google is your only way to sign in. Set a password before disconnecting it.",
      ),
    ).toBeTruthy();
  });

  it("shows the server's last-method refusal", async () => {
    auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_PASSWORD, ACCOUNT_GOOGLE));
    auth.unlinkAccount.mockResolvedValue({
      data: null,
      error: { code: "FAILED_TO_UNLINK_LAST_ACCOUNT", status: 400 },
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Google" }));
    const message = await screen.findByText(
      "Google is your only way to sign in. Set a password before disconnecting it.",
    );
    expect(message.getAttribute("role")).toBe("alert");
  });

  it("asks to sign in again when the session is not fresh", async () => {
    auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_PASSWORD, ACCOUNT_GOOGLE));
    auth.unlinkAccount.mockResolvedValue({
      data: null,
      error: { code: "SESSION_NOT_FRESH", status: 403 },
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Google" }));
    expect(
      await screen.findByText("For your security, sign in again to disconnect Google."),
    ).toBeTruthy();
  });
});

describe("GoogleSignInControls — set a password", () => {
  beforeEach(() => {
    auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_GOOGLE));
  });

  it("is offered to a Google-only account, not to one with a password", async () => {
    renderSection();
    expect(await screen.findByRole("heading", { name: "Set a password" })).toBeTruthy();
    cleanup();
    auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_PASSWORD, ACCOUNT_GOOGLE));
    renderSection();
    await screen.findByRole("button", { name: "Disconnect Google" });
    expect(screen.queryByRole("heading", { name: "Set a password" })).toBeNull();
  });

  it("saves the password and keeps a confirmation after the list refreshes", async () => {
    api.setPassword.mockResolvedValue({ data: { status: true }, error: null });
    renderSection();
    await screen.findByRole("heading", { name: "Set a password" });
    auth.listAccounts.mockResolvedValue(accounts(ACCOUNT_PASSWORD, ACCOUNT_GOOGLE));
    fill("New password", "fresh-password-1");
    fill("Confirm new password", "fresh-password-1");
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));

    expect(
      await screen.findByText(
        "Password saved. You can now sign in on the desktop app with your email and this password.",
      ),
    ).toBeTruthy();
    expect(api.setPassword).toHaveBeenCalledWith({ newPassword: "fresh-password-1" });
    // The refreshed list now has a password: "Change password" replaces this form.
    expect(await screen.findByRole("heading", { name: "Change password" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Set a password" })).toBeNull();
  });

  it("validates before calling the API", async () => {
    renderSection();
    await screen.findByRole("heading", { name: "Set a password" });
    fill("New password", "short");
    fill("Confirm new password", "other");
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Use at least 8 characters.")).toBeTruthy();
    expect(screen.getByText("The passwords do not match.")).toBeTruthy();
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  it("explains a 409 (a password already exists)", async () => {
    api.setPassword.mockRejectedValue(orpcError(409));
    renderSection();
    await screen.findByRole("heading", { name: "Set a password" });
    fill("New password", "fresh-password-1");
    fill("Confirm new password", "fresh-password-1");
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("This account already has a password.")).toBeTruthy();
  });

  it("speaks Spanish in the es locale", async () => {
    renderSection("es");
    expect(await screen.findByRole("heading", { name: "Crear una contraseña" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desconectar Google" })).toBeTruthy();
  });
});
