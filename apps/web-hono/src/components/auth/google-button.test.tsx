import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const social = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/auth-client", () => ({ authClient: { signIn: { social } } }));

import { GoogleButton } from "./google-button";

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
    const button = await screen.findByRole("button", { name: "Waiting for Google…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
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
    expect(
      await screen.findByText(
        "Google sign-in isn't available right now. Use your email and password.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Provider not found/)).toBeNull();
    cleanup();

    renderWithProviders(<GoogleButton mode="sign-in" />, "es");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    expect(
      await screen.findByText(
        "El inicio de sesión con Google no está disponible ahora. Usa tu correo y contraseña.",
      ),
    ).toBeTruthy();
  });

  it("reads Sign up with Google on the sign-up tab, and marks itself recommended", () => {
    renderWithProviders(<GoogleButton mode="sign-up" />);
    const button = screen.getByRole("button", { name: "Sign up with Google" });
    // The tag is decoration: it is in the button but not in its accessible name.
    expect(button.textContent).toContain("Recommended");
  });

  it("speaks Spanish in the es locale", () => {
    renderWithProviders(<GoogleButton mode="sign-in" />, "es");
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeTruthy();
  });
});
