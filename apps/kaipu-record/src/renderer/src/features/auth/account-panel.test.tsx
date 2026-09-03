import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountPanel } from "./account-panel";

describe("AccountPanel", () => {
  it("shows sign-in/sign-up buttons when signed out", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    render(<AccountPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("shows the email and a sign-out button when signed in", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
    });
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("shows a verify-failed note when status is unknown, not a login prompt", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "unknown",
      lastKnownEmail: "a@b.com",
    });
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText(/couldn't verify/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retries an unknown session check on request", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus")
      .mockResolvedValueOnce({ kind: "unknown", lastKnownEmail: "a@b.com" })
      .mockResolvedValueOnce({ kind: "signed-in", email: "a@b.com", name: "A" });
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
  });

  it("opens the sign-in form, submits it, and shows an inline error on failure", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    const signIn = vi.spyOn(window.electronAPI, "signIn").mockRejectedValue({
      kind: "invalid-credentials",
    });
    render(<AccountPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /sign in/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({ email: "a@b.com", password: "wrong" }),
    );
    await waitFor(() => expect(screen.getByText(/wrong email or password/i)).toBeInTheDocument());
  });

  it("disables the submit button while the request is pending", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    let resolveSignIn: (v: never) => void = () => {};
    vi.spyOn(window.electronAPI, "signIn").mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    render(<AccountPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /sign in/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    resolveSignIn({ kind: "signed-in", email: "a@b.com", name: "A" } as never);
  });
});
