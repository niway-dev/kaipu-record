import { describe, expect, it, vi } from "vitest";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AccountPanel } from "./account-panel";

/** Echoes where the panel navigated to (path + the `from` it attached). */
function Landed(): React.JSX.Element {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "";
  return (
    <p>
      landed {location.pathname} from {from}
    </p>
  );
}

function renderPanel(): void {
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<AccountPanel />} />
        <Route path="/sign-in" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AccountPanel", () => {
  it("says an account is optional and offers only Sign in when signed out", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/your kaipu account/i)).toBeInTheDocument();
    expect(screen.getByText(/without an account/i)).toBeInTheDocument();
    // Creating an account is reached from the sign-in page, not from Settings.
    expect(screen.queryByRole("button", { name: /create account/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("opens the sign-in page, telling it to come back to Settings", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /sign in/i }));
    expect(screen.getByText("landed /sign-in from /settings")).toBeInTheDocument();
  });

  it("shows the email and a sign-out button when signed in", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("shows a verify-failed note when status is unknown, not a login prompt", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "unknown",
      lastKnownEmail: "a@b.com",
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/couldn't verify/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retries an unknown session check on request", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus")
      .mockResolvedValueOnce({ kind: "unknown", lastKnownEmail: "a@b.com" })
      .mockResolvedValueOnce({
        kind: "signed-in",
        email: "a@b.com",
        name: "A",
        entitlements: FREE_ENTITLEMENTS,
      });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
  });

  it("signs out and returns to the signed-out row", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });
    const signOut = vi.spyOn(window.electronAPI, "signOut").mockResolvedValue(undefined);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument(),
    );
  });
});
