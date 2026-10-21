import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AuthStatus } from "@shared/types/auth";
import { AuthPage } from "./auth-page";

const SIGNED_IN = {
  kind: "signed-in",
  userId: "user-1",
  email: "a@b.com",
  name: "A",
  entitlements: FREE_ENTITLEMENTS,
} as const;

function Landed(): React.JSX.Element {
  const location = useLocation();
  return <p>landed {location.pathname}</p>;
}

function renderAt(from?: string): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/sign-in", state: from ? { from } : undefined }]}>
      <Routes>
        <Route path="/sign-in" element={<AuthPage />} />
        <Route path="/settings" element={<Landed />} />
        <Route path="/library" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Capture the broadcast subscription so a test can play the part of main announcing a sign-in. */
function captureBroadcast(): { send(status: AuthStatus): void } {
  let listener: ((status: AuthStatus) => void) | undefined;
  vi.spyOn(window.electronAPI, "onAuthStatusChanged").mockImplementation((cb) => {
    listener = cb;
    return () => {};
  });
  return { send: (status) => listener?.(status) };
}

async function signedOutPage(from?: string): Promise<void> {
  vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
  renderAt(from);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /sign in with your browser/i })).toBeEnabled(),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthPage", () => {
  it("has no password field: it offers the browser instead", async () => {
    await signedOutPage();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    // The cloud promo copy stays.
    expect(screen.getByText(/250 MB free/i)).toBeInTheDocument();
  });

  it("idle -> waiting -> signed in: opens the browser, waits, then returns to the route that opened it", async () => {
    const broadcast = captureBroadcast();
    const begin = vi
      .spyOn(window.electronAPI, "beginBrowserSignIn")
      .mockResolvedValue({ ok: true });
    await signedOutPage("/library");

    fireEvent.click(screen.getByRole("button", { name: /sign in with your browser/i }));

    expect(begin).toHaveBeenCalledWith("sign-in");
    expect(
      await screen.findByRole("heading", { name: /finish signing in in your browser/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open browser again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();

    broadcast.send(SIGNED_IN);
    await waitFor(() => expect(screen.getByText("landed /library")).toBeInTheDocument());
  });

  it("Create account runs the same flow with the sign-up intent", async () => {
    const begin = vi
      .spyOn(window.electronAPI, "beginBrowserSignIn")
      .mockResolvedValue({ ok: true });
    await signedOutPage();

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(begin).toHaveBeenCalledWith("sign-up"));
    await screen.findByRole("heading", { name: /finish signing in/i });
    // "Open browser again" repeats the intent the user chose.
    fireEvent.click(screen.getByRole("button", { name: /open browser again/i }));
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
    expect(begin).toHaveBeenLastCalledWith("sign-up");
  });

  it("falls back to Settings when nothing sent the user here", async () => {
    const broadcast = captureBroadcast();
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({ ok: true });
    await signedOutPage();
    fireEvent.click(screen.getByRole("button", { name: /sign in with your browser/i }));
    await screen.findByRole("heading", { name: /finish signing in/i });

    broadcast.send(SIGNED_IN);

    await waitFor(() => expect(screen.getByText("landed /settings")).toBeInTheDocument());
  });

  it("pasting the code signs in", async () => {
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({ ok: true });
    const submit = vi
      .spyOn(window.electronAPI, "submitSignInCode")
      .mockResolvedValue({ ok: true, status: SIGNED_IN });
    await signedOutPage("/library");
    fireEvent.click(screen.getByRole("button", { name: /sign in with your browser/i }));
    await screen.findByRole("heading", { name: /finish signing in/i });

    const continueButton = screen.getByRole("button", { name: /^continue$/i });
    expect(continueButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: " abc123 " } });
    fireEvent.click(continueButton);

    await waitFor(() => expect(submit).toHaveBeenCalledWith(" abc123 "));
    await waitFor(() => expect(screen.getByText("landed /library")).toBeInTheDocument());
  });

  it.each([
    [{ kind: "invalid-code" }, /invalid, expired or already used/i],
    [{ kind: "state-mismatch" }, /not started from this app/i],
    [{ kind: "network" }, /couldn't reach the server/i],
  ] as const)("a failed code (%j) shows its own message and keeps waiting", async (error, copy) => {
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({ ok: true });
    vi.spyOn(window.electronAPI, "submitSignInCode").mockResolvedValue({ ok: false, error });
    await signedOutPage();
    fireEvent.click(screen.getByRole("button", { name: /sign in with your browser/i }));
    await screen.findByRole("heading", { name: /finish signing in/i });

    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("heading", { name: /finish signing in/i })).toBeInTheDocument();
  });

  it("shows why the browser could not be opened and stays on the first screen", async () => {
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({
      ok: false,
      error: { kind: "not-configured" },
    });
    await signedOutPage();

    fireEvent.click(screen.getByRole("button", { name: /sign in with your browser/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/does not know where to sign in/i);
    expect(screen.queryByRole("heading", { name: /finish signing in/i })).not.toBeInTheDocument();
  });

  it("Cancel stops waiting and tells main, so a late link is ignored", async () => {
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({ ok: true });
    const cancel = vi.spyOn(window.electronAPI, "cancelBrowserSignIn").mockResolvedValue();
    await signedOutPage();
    fireEvent.click(screen.getByRole("button", { name: /sign in with your browser/i }));
    await screen.findByRole("heading", { name: /finish signing in/i });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(cancel).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("button", { name: /sign in with your browser/i }),
    ).toBeInTheDocument();
  });

  it("leaves immediately when the user is already signed in", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue(SIGNED_IN);
    renderAt();
    await waitFor(() => expect(screen.getByText("landed /settings")).toBeInTheDocument());
  });

  it("goes back without signing in", async () => {
    await signedOutPage("/library");
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("landed /library")).toBeInTheDocument();
  });
});
