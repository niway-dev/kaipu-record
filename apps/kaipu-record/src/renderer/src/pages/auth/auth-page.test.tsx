import { describe, expect, it, vi } from "vitest";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AuthAttemptResult } from "@shared/types/electron-api";
import { AuthPage } from "./auth-page";

const SIGNED_IN = {
  kind: "signed-in",
  email: "a@b.com",
  name: "A",
  entitlements: FREE_ENTITLEMENTS,
} as const;

function Landed(): React.JSX.Element {
  const location = useLocation();
  return <p>landed {location.pathname}</p>;
}

function renderAt(path: "/sign-in" | "/sign-up", from?: string): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state: from ? { from } : undefined }]}>
      <Routes>
        <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
        <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
        <Route path="/settings" element={<Landed />} />
        <Route path="/library" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Fill and submit. Waits for the initial status load first: until it resolves the hook
 *  reports `pending`, the submit button is disabled, and a click would do nothing. */
async function submit(email: string, password: string): Promise<void> {
  await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

describe("AuthPage", () => {
  it("signs in and returns to the route that opened it", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    const signIn = vi
      .spyOn(window.electronAPI, "signIn")
      .mockResolvedValue({ ok: true, status: SIGNED_IN });
    renderAt("/sign-in", "/library");

    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    await submit("a@b.com", "pw");

    await waitFor(() => expect(signIn).toHaveBeenCalledWith({ email: "a@b.com", password: "pw" }));
    await waitFor(() => expect(screen.getByText("landed /library")).toBeInTheDocument());
  });

  it("falls back to Settings when nothing sent the user here", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    vi.spyOn(window.electronAPI, "signIn").mockResolvedValue({ ok: true, status: SIGNED_IN });
    renderAt("/sign-in");

    await submit("a@b.com", "pw");

    await waitFor(() => expect(screen.getByText("landed /settings")).toBeInTheDocument());
  });

  it("leaves immediately when the user is already signed in", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue(SIGNED_IN);
    renderAt("/sign-in");
    await waitFor(() => expect(screen.getByText("landed /settings")).toBeInTheDocument());
  });

  it("goes back without signing in", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    renderAt("/sign-in", "/library");
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("landed /library")).toBeInTheDocument();
  });

  it("signs up with a name and lands on Settings", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    const signUp = vi
      .spyOn(window.electronAPI, "signUp")
      .mockResolvedValue({ ok: true, status: SIGNED_IN });
    renderAt("/sign-up");

    expect(screen.getByRole("heading", { name: /create account/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ada" } });
    await submit("a@b.com", "longenough");

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: "a@b.com",
        name: "Ada",
        password: "longenough",
      }),
    );
    await waitFor(() => expect(screen.getByText("landed /settings")).toBeInTheDocument());
  });

  // The IPC layer reports a credential failure as a RESOLVED `{ ok: false, error }` value,
  // never a rejection: Electron strips a thrown error down to its `.message`, which would
  // lose the `kind` this assertion depends on.
  it("shows the specific error inline, then drops it when switching to sign-up", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    vi.spyOn(window.electronAPI, "signIn").mockResolvedValue({
      ok: false,
      error: { kind: "invalid-credentials" },
    });
    renderAt("/sign-in");

    await submit("a@b.com", "wrong");
    await waitFor(() => expect(screen.getByText(/wrong email or password/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("link", { name: /sign up/i }));
    expect(screen.getByRole("heading", { name: /create account/i })).toBeInTheDocument();
    expect(screen.queryByText(/wrong email or password/i)).not.toBeInTheDocument();
    // Fresh form: the sign-in email did not carry over.
    expect(screen.getByLabelText(/email/i)).toHaveValue("");
  });

  it("disables submit while the attempt is in flight", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    let resolveSignIn: (v: AuthAttemptResult) => void = () => {};
    vi.spyOn(window.electronAPI, "signIn").mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    renderAt("/sign-in");

    await submit("a@b.com", "pw");

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    resolveSignIn({ ok: true, status: SIGNED_IN });
    await waitFor(() => expect(screen.getByText("landed /settings")).toBeInTheDocument());
  });
});
