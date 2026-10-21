import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AuthError, AuthStatus } from "@shared/types/auth";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";
import { useAuthStatus } from "./use-auth-status";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAuthStatus", () => {
  it("loads the status on mount", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });

    const { result } = renderHook(() => useAuthStatus());

    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "signed-in",
        userId: "user-1",
        email: "a@b.com",
        name: "A",
        entitlements: FREE_ENTITLEMENTS,
      }),
    );
  });

  it("subscribes to onAuthStatusChanged and updates on broadcast", async () => {
    let broadcast: ((status: AuthStatus) => void) | undefined;
    vi.spyOn(window.electronAPI, "onAuthStatusChanged").mockImplementation((cb) => {
      broadcast = cb;
      return () => {};
    });

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    act(() =>
      broadcast?.({
        kind: "signed-in",
        userId: "user-x",
        email: "x@y.com",
        name: "X",
        entitlements: FREE_ENTITLEMENTS,
      }),
    );

    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "signed-in",
        userId: "user-x",
        email: "x@y.com",
        name: "X",
        entitlements: FREE_ENTITLEMENTS,
      }),
    );
  });

  const SIGNED_IN: AuthStatus = {
    kind: "signed-in",
    userId: "user-1",
    email: "a@b.com",
    name: "A",
    entitlements: FREE_ENTITLEMENTS,
  };

  it("walks idle -> waiting -> signed in when the link completes the sign-in", async () => {
    let broadcast: ((status: AuthStatus) => void) | undefined;
    vi.spyOn(window.electronAPI, "onAuthStatusChanged").mockImplementation((cb) => {
      broadcast = cb;
      return () => {};
    });
    const begin = vi
      .spyOn(window.electronAPI, "beginBrowserSignIn")
      .mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.phase).toBe("idle");

    await act(async () => {
      await result.current.startBrowserSignIn("sign-in");
    });
    expect(begin).toHaveBeenCalledWith("sign-in");
    expect(result.current.phase).toBe("waiting");

    act(() => broadcast?.(SIGNED_IN));
    expect(result.current.phase).toBe("idle");
    expect(result.current.status).toEqual(SIGNED_IN);
  });

  it("starts the sign-up variant through the same call", async () => {
    const begin = vi
      .spyOn(window.electronAPI, "beginBrowserSignIn")
      .mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAuthStatus());
    await act(async () => {
      await result.current.startBrowserSignIn("sign-up");
    });
    expect(begin).toHaveBeenCalledWith("sign-up");
  });

  it("stays idle and surfaces the error when the browser could not be opened", async () => {
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({
      ok: false,
      error: { kind: "not-configured" },
    });
    const { result } = renderHook(() => useAuthStatus());
    await act(async () => {
      await result.current.startBrowserSignIn("sign-in");
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ kind: "not-configured" });
  });

  it("cancel returns to idle, clears the error and tells main", async () => {
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({ ok: true });
    const cancel = vi.spyOn(window.electronAPI, "cancelBrowserSignIn").mockResolvedValue();
    const { result } = renderHook(() => useAuthStatus());
    await act(async () => {
      await result.current.startBrowserSignIn("sign-in");
    });

    await act(async () => {
      await result.current.cancelBrowserSignIn();
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("a pasted code signs in, and a bad one keeps waiting with its error", async () => {
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({ ok: true });
    const submit = vi
      .spyOn(window.electronAPI, "submitSignInCode")
      .mockResolvedValueOnce({ ok: false, error: { kind: "invalid-code" } })
      .mockResolvedValueOnce({ ok: true, status: SIGNED_IN });
    const { result } = renderHook(() => useAuthStatus());
    await act(async () => {
      await result.current.startBrowserSignIn("sign-in");
    });

    await act(async () => {
      await result.current.submitCode("bad");
    });
    expect(result.current.error).toEqual({ kind: "invalid-code" });
    expect(result.current.phase).toBe("waiting");
    expect(result.current.submittingCode).toBe(false);

    await act(async () => {
      await result.current.submitCode("good");
    });
    expect(submit).toHaveBeenLastCalledWith("good");
    expect(result.current.error).toBeNull();
    expect(result.current.status).toEqual(SIGNED_IN);
    expect(result.current.phase).toBe("idle");
  });

  it("a link that came back but failed ends the wait and shows why", async () => {
    let failed: ((error: AuthError) => void) | undefined;
    vi.spyOn(window.electronAPI, "onBrowserSignInFailed").mockImplementation((cb) => {
      failed = cb;
      return () => {};
    });
    vi.spyOn(window.electronAPI, "beginBrowserSignIn").mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAuthStatus());
    await act(async () => {
      await result.current.startBrowserSignIn("sign-in");
    });

    act(() => failed?.({ kind: "state-mismatch" }));

    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ kind: "state-mismatch" });
  });

  // The IPC call itself can reject (e.g. a call from an unexpected sender), which is not a
  // sign-in failure; the hook must turn it into an error instead of getting stuck.
  it("recovers from the IPC call itself rejecting", async () => {
    vi.spyOn(window.electronAPI, "submitSignInCode").mockRejectedValue(
      new Error("auth IPC calls are only accepted from the main window"),
    );
    const { result } = renderHook(() => useAuthStatus());

    await act(async () => {
      await result.current.submitCode("x");
    });

    expect(result.current.submittingCode).toBe(false);
    expect(result.current.error).toEqual({
      kind: "unknown",
      message: "auth IPC calls are only accepted from the main window",
    });
  });

  it("sign-out clears the status", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue(SIGNED_IN);
    const signOut = vi.spyOn(window.electronAPI, "signOut").mockResolvedValue();
    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status.kind).toBe("signed-in"));

    await act(async () => {
      await result.current.signOut();
    });

    expect(signOut).toHaveBeenCalledOnce();
    expect(result.current.status).toEqual({ kind: "signed-out" });
  });

  it("refreshes an unknown status on explicit retry", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus")
      .mockResolvedValueOnce({ kind: "unknown", lastKnownEmail: "a@b.com" })
      .mockResolvedValueOnce({
        kind: "signed-in",
        userId: "user-1",
        email: "a@b.com",
        name: "A",
        entitlements: FREE_ENTITLEMENTS,
      });
    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status.kind).toBe("unknown"));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.status).toEqual({
      kind: "signed-in",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });
  });

  it("prefers a broadcast that arrives during the initial query over the stale query response", async () => {
    let resolveGetStatus: ((status: AuthStatus) => void) | undefined;
    let broadcast: ((status: AuthStatus) => void) | undefined;
    vi.spyOn(window.electronAPI, "getAuthStatus").mockReturnValue(
      new Promise<AuthStatus>((resolve) => {
        resolveGetStatus = resolve;
      }),
    );
    vi.spyOn(window.electronAPI, "onAuthStatusChanged").mockImplementation((cb) => {
      broadcast = cb;
      return () => {};
    });

    const { result } = renderHook(() => useAuthStatus());

    // At this point:
    // - onAuthStatusChanged is subscribed (broadcast callback captured)
    // - getAuthStatus promise is in flight (not yet resolved)

    // Trigger a broadcast BEFORE the getAuthStatus query resolves
    act(() =>
      broadcast?.({
        kind: "signed-in",
        userId: "user-broadcast",
        email: "broadcast@example.com",
        name: "Broadcast",
        entitlements: FREE_ENTITLEMENTS,
      }),
    );

    // Verify the broadcast took effect
    expect(result.current.status).toEqual({
      kind: "signed-in",
      userId: "user-broadcast",
      email: "broadcast@example.com",
      name: "Broadcast",
      entitlements: FREE_ENTITLEMENTS,
    });

    // Now resolve the original getAuthStatus promise with a DIFFERENT status (which is now stale)
    await act(async () => {
      resolveGetStatus?.({
        kind: "signed-in",
        userId: "user-stale",
        email: "stale@example.com",
        name: "Stale",
        entitlements: FREE_ENTITLEMENTS,
      });
    });

    // The status should STILL be the broadcast value, not the stale query response
    expect(result.current.status).toEqual({
      kind: "signed-in",
      userId: "user-broadcast",
      email: "broadcast@example.com",
      name: "Broadcast",
      entitlements: FREE_ENTITLEMENTS,
    });
  });
});
