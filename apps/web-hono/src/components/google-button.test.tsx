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
  it("starts the Google redirect and lands on the dashboard by default", async () => {
    renderWithProviders(<GoogleButton mode="sign-in" />);
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
    renderWithProviders(<GoogleButton mode="sign-in" redirectTo="/dashboard/profile" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(social).toHaveBeenLastCalledWith(
      expect.objectContaining({ callbackURL: "/dashboard/profile" }),
    );
    cleanup();

    renderWithProviders(<GoogleButton mode="sign-in" redirectTo="https://evil.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(social).toHaveBeenLastCalledWith(expect.objectContaining({ callbackURL: "/dashboard" }));
  });

  it("on the desktop pages, carries the app's query and returns to them (NIW2-471)", () => {
    const desktop = {
      client_id: "kaipu-desktop",
      state: "Ab12Cd34Ef56Gh78",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    };
    const search = `client_id=kaipu-desktop&state=Ab12Cd34Ef56Gh78&code_challenge=${desktop.code_challenge}`;
    renderWithProviders(
      <GoogleButton mode="sign-in" desktop={desktop} redirectTo="/dashboard/profile" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `/auth/desktop/done?${search}`,
      newUserCallbackURL: `/auth/desktop/done?${search}`,
      errorCallbackURL: `/auth/desktop?${search}`,
      fetchOptions: { query: desktop },
    });
  });

  it("re-enables the button when the request fails before leaving the page", async () => {
    social.mockResolvedValue({ data: null, error: { message: "nope" } });
    renderWithProviders(<GoogleButton mode="sign-in" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it("says Google is unavailable when the server has no Google provider", async () => {
    social.mockResolvedValue({
      data: null,
      error: { code: "PROVIDER_NOT_FOUND", status: 404, message: "Provider not found" },
    });
    renderWithProviders(<GoogleButton mode="sign-in" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Google sign-in isn't available right now. Use your email and password.",
    );
    expect(screen.queryByText(/Provider not found/)).toBeNull();
    cleanup();

    renderWithProviders(<GoogleButton mode="sign-in" />, "es");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "El inicio de sesión con Google no está disponible ahora. Usa tu correo y contraseña.",
    );
  });

  it("shows the Google legal notice on sign-up only", () => {
    renderWithProviders(<GoogleButton mode="sign-up" />);
    expect(screen.getByText("legal:googleSignupNotice")).toBeTruthy();
    cleanup();
    renderWithProviders(<GoogleButton mode="sign-in" />);
    expect(screen.queryByText(/legal:/)).toBeNull();
  });

  it("speaks Spanish in the es locale", () => {
    renderWithProviders(<GoogleButton mode="sign-in" />, "es");
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
