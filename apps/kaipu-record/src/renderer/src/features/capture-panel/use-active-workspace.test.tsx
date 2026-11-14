import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspacesState } from "@shared/types/workspaces";
import { useActiveWorkspace } from "./use-active-workspace";

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
  vi.restoreAllMocks();
});

function stateWith(id: string, name: string): WorkspacesState {
  return { activeId: id, workspaces: [{ id, name }] } as unknown as WorkspacesState;
}

function givenWorkspaces(list: () => Promise<WorkspacesState>) {
  let emit: (next: WorkspacesState) => void = () => {};
  window.electronAPI = {
    ...realApi,
    workspaces: {
      ...realApi.workspaces,
      list,
      onChanged: (cb: (next: WorkspacesState) => void) => {
        emit = cb;
        return () => {};
      },
    },
  } as typeof realApi;
  return (next: WorkspacesState) => emit(next);
}

describe("useActiveWorkspace", () => {
  it("lets a broadcast that arrives before list() resolves win over the late list result", async () => {
    let resolveList: (state: WorkspacesState) => void = () => {};
    const emit = givenWorkspaces(() => new Promise((resolve) => (resolveList = resolve)));
    const { result } = renderHook(() => useActiveWorkspace());
    expect(result.current).toBeNull();

    act(() => emit(stateWith("new", "Newer")));
    await waitFor(() => expect(result.current?.id).toBe("new"));

    await act(async () => resolveList(stateWith("old", "Older")));
    expect(result.current?.id).toBe("new");
  });

  it("stays null without throwing when list() rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    givenWorkspaces(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() => useActiveWorkspace());
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
