import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAuthStatus } from "./use-auth-status";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAuthStatus", () => {
  it("loads the status on mount", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
    });

    const { result } = renderHook(() => useAuthStatus());

    await waitFor(() =>
      expect(result.current.status).toEqual({ kind: "signed-in", email: "a@b.com", name: "A" }),
    );
  });

  it("subscribes to onAuthStatusChanged and updates on broadcast", async () => {
    let broadcast: ((s: unknown) => void) | undefined;
    vi.spyOn(window.electronAPI, "onAuthStatusChanged").mockImplementation((cb) => {
      broadcast = cb;
      return () => {};
    });

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    act(() => broadcast?.({ kind: "signed-in", email: "x@y.com", name: "X" }));

    await waitFor(() =>
      expect(result.current.status).toEqual({ kind: "signed-in", email: "x@y.com", name: "X" }),
    );
  });

  it("signIn sets pending during the call and surfaces an AuthError on failure", async () => {
    let rejectSignIn: (error: unknown) => void = () => {};
    vi.spyOn(window.electronAPI, "signIn").mockReturnValue(
      new Promise((_, reject) => {
        rejectSignIn = reject;
      }),
    );

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    const promise = result.current.signIn({ email: "a@b.com", password: "wrong" });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      rejectSignIn({ kind: "invalid-credentials" });
      await promise;
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toEqual({ kind: "invalid-credentials" });
  });

  it("a new attempt clears the previous error", async () => {
    vi.spyOn(window.electronAPI, "signIn")
      .mockRejectedValueOnce({ kind: "invalid-credentials" })
      .mockResolvedValueOnce({ kind: "signed-in", email: "a@b.com", name: "A" });

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    await act(async () => {
      await result.current.signIn({ email: "a@b.com", password: "wrong" }).catch(() => {});
    });
    expect(result.current.error).toEqual({ kind: "invalid-credentials" });

    await act(async () => {
      await result.current.signIn({ email: "a@b.com", password: "right" });
    });
    expect(result.current.error).toBeNull();
  });

  it("refreshes an unknown status on explicit retry", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus")
      .mockResolvedValueOnce({ kind: "unknown", lastKnownEmail: "a@b.com" })
      .mockResolvedValueOnce({ kind: "signed-in", email: "a@b.com", name: "A" });
    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status.kind).toBe("unknown"));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.status).toEqual({ kind: "signed-in", email: "a@b.com", name: "A" });
  });
});
