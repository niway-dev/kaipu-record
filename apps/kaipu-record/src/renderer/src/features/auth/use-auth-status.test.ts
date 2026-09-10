import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AuthStatus } from "@shared/types/auth";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";
import type { AuthAttemptResult } from "@shared/types/electron-api";
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

  it("signIn sets pending during the call and surfaces an AuthError on failure", async () => {
    let resolveSignIn: (result: AuthAttemptResult) => void = () => {};
    vi.spyOn(window.electronAPI, "signIn").mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    const promise = result.current.signIn({ email: "a@b.com", password: "wrong" });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      resolveSignIn({ ok: false, error: { kind: "invalid-credentials" } });
      await promise;
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toEqual({ kind: "invalid-credentials" });
  });

  // Regression test: signIn/signUp report a CREDENTIAL failure as a resolved
  // `{ ok: false, error }`, never a rejection — but the IPC call itself can still reject for a
  // reason unrelated to credentials (e.g. auth-store.ts's requireMainWindow guard). Without a
  // catch around `attempt()`, that rejection propagates uncaught: `pending` never resets and the
  // form is stuck disabled forever with no error shown.
  it("recovers from the IPC call itself rejecting (not a credential failure)", async () => {
    vi.spyOn(window.electronAPI, "signIn").mockRejectedValue(
      new Error("auth IPC calls are only accepted from the main window"),
    );

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    await act(async () => {
      await result.current.signIn({ email: "a@b.com", password: "x" });
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toEqual({
      kind: "unknown",
      message: "auth IPC calls are only accepted from the main window",
    });
  });

  it("a new attempt clears the previous error", async () => {
    vi.spyOn(window.electronAPI, "signIn")
      .mockResolvedValueOnce({ ok: false, error: { kind: "invalid-credentials" } })
      .mockResolvedValueOnce({
        ok: true,
        status: {
          kind: "signed-in",
          userId: "user-1",
          email: "a@b.com",
          name: "A",
          entitlements: FREE_ENTITLEMENTS,
        },
      });

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    await act(async () => {
      await result.current.signIn({ email: "a@b.com", password: "wrong" });
    });
    expect(result.current.error).toEqual({ kind: "invalid-credentials" });

    await act(async () => {
      await result.current.signIn({ email: "a@b.com", password: "right" });
    });
    expect(result.current.error).toBeNull();
    expect(result.current.status).toEqual({
      kind: "signed-in",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });
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
