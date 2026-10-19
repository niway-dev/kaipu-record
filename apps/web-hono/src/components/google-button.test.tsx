import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const social = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/auth-client", () => ({ authClient: { signIn: { social } } }));
vi.mock("@/components/legal/signup-legal-notice", () => ({
  SignupLegalNotice: ({ messageKey }: { messageKey?: string }) => <p>legal:{messageKey}</p>,
}));

import { GoogleButton } from "./google-button";
import { OAuthErrorAlert } from "./oauth-error-alert";

beforeEach(() => {
  social.mockReset();
  // A real redirect never resolves from the page's point of view.
  social.mockImplementation(() => new Promise(() => {}));
});
afterEach(cleanup);

describe("GoogleButton", () => {
  it("renders nothing while Google is not configured", () => {
    renderWithProviders(<GoogleButton mode="sign-in" enabled={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });

  it("starts the Google redirect and lands on the dashboard by default", async () => {
    renderWithProviders(<GoogleButton mode="sign-in" enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/dashboard",
      newUserCallbackURL: "/dashboard",
      errorCallbackURL: "/auth/login",
    });
    const button = await screen.findByRole("button", { name: "Redirecting to Google…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("honours a same-origin redirect and ignores an off-site one", () => {
    renderWithProviders(<GoogleButton mode="sign-in" enabled redirectTo="/dashboard/profile" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(social).toHaveBeenLastCalledWith(
      expect.objectContaining({ callbackURL: "/dashboard/profile" }),
    );
    cleanup();

    renderWithProviders(<GoogleButton mode="sign-in" enabled redirectTo="https://evil.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(social).toHaveBeenLastCalledWith(expect.objectContaining({ callbackURL: "/dashboard" }));
  });

  it("re-enables the button when the request fails before leaving the page", async () => {
    social.mockResolvedValue({ data: null, error: { message: "nope" } });
    renderWithProviders(<GoogleButton mode="sign-in" enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it("shows the Google legal notice on sign-up only", () => {
    renderWithProviders(<GoogleButton mode="sign-up" enabled />);
    expect(screen.getByText("legal:googleSignupNotice")).toBeTruthy();
    cleanup();
    renderWithProviders(<GoogleButton mode="sign-in" enabled />);
    expect(screen.queryByText(/legal:/)).toBeNull();
  });

  it("speaks Spanish in the es locale", () => {
    renderWithProviders(<GoogleButton mode="sign-in" enabled />, "es");
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeTruthy();
    expect(screen.getByText("o")).toBeTruthy();
  });
});

describe("OAuthErrorAlert", () => {
  it("renders nothing without an error", () => {
    renderWithProviders(<OAuthErrorAlert />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("maps a cancelled consent screen to friendly copy", () => {
    renderWithProviders(<OAuthErrorAlert code="access_denied" />);
    expect(screen.getByRole("alert").textContent).toBe(
      "Google sign-in was cancelled. You can try again or use your email and password.",
    );
  });

  it("never shows a raw code", () => {
    renderWithProviders(<OAuthErrorAlert code="internal_server_error" />);
    expect(screen.getByRole("alert").textContent).not.toContain("internal_server_error");
  });

  it("speaks Spanish in the es locale", () => {
    renderWithProviders(<OAuthErrorAlert code="account_already_linked_to_different_user" />, "es");
    expect(screen.getByRole("alert").textContent).toBe(
      "Esa cuenta de Google ya está conectada a otra cuenta de Kaipu.",
    );
  });
});
