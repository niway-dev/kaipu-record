import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/render";
import { OAuthErrorAlert } from "./oauth-error-alert";

afterEach(cleanup);

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
