import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const api = vi.hoisted(() => ({ takeNotices: vi.fn() }));
vi.mock("@/lib/orpc-client", () => ({ client: { me: api } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { CredentialDroppedNotice } from "./credential-dropped-notice";

// Braces matter: Vitest runs a function returned from beforeEach as teardown.
beforeEach(() => {
  api.takeNotices.mockReset();
});
afterEach(cleanup);

describe("CredentialDroppedNotice", () => {
  it("shows the one-time banner with a link to set a password", async () => {
    api.takeNotices.mockResolvedValue({ data: { credentialDropped: true }, error: null });
    renderWithProviders(<CredentialDroppedNotice />);
    expect(await screen.findByText("We removed an old password from your account")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set a password" }).getAttribute("href")).toBe(
      "/dashboard/profile",
    );
    expect(api.takeNotices).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed", async () => {
    api.takeNotices.mockResolvedValue({ data: { credentialDropped: true }, error: null });
    renderWithProviders(<CredentialDroppedNotice />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("We removed an old password from your account")).toBeNull();
  });

  it("shows nothing when there is no notice", async () => {
    api.takeNotices.mockResolvedValue({ data: { credentialDropped: false }, error: null });
    const { container } = renderWithProviders(<CredentialDroppedNotice />);
    await waitFor(() => expect(api.takeNotices).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("shows nothing, and does not ask again, when the request fails", async () => {
    let calls = 0;
    api.takeNotices.mockImplementation(() => {
      calls += 1;
      return Promise.reject(Object.assign(new Error("HTTP 503"), { status: 503 }));
    });
    const { container } = renderWithProviders(<CredentialDroppedNotice />);
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);
    expect(container.textContent).toBe("");
  });

  it("speaks Spanish in the es locale", async () => {
    api.takeNotices.mockResolvedValue({ data: { credentialDropped: true }, error: null });
    renderWithProviders(<CredentialDroppedNotice />, "es");
    expect(await screen.findByText("Quitamos una contraseña antigua de tu cuenta")).toBeTruthy();
  });
});
