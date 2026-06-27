import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRenameRecording } from "./use-rename-recording";

describe("useRenameRecording", () => {
  it("starts idle and seeds the draft with the current title on edit", () => {
    const { result } = renderHook(() => useRenameRecording("Demo", vi.fn()));
    expect(result.current.editing).toBe(false);
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(true);
    expect(result.current.draft).toBe("Demo");
  });

  it("renames with the trimmed draft when it actually changed", () => {
    const onRename = vi.fn();
    const { result } = renderHook(() => useRenameRecording("Demo", onRename));
    act(() => result.current.startEdit());
    act(() => result.current.setDraft("  New title  "));
    act(() => result.current.commitEdit());
    expect(onRename).toHaveBeenCalledWith("New title");
    expect(result.current.editing).toBe(false);
  });

  it("does not rename when the draft is empty or only whitespace", () => {
    const onRename = vi.fn();
    const { result } = renderHook(() => useRenameRecording("Demo", onRename));
    act(() => result.current.startEdit());
    act(() => result.current.setDraft("   "));
    act(() => result.current.commitEdit());
    expect(onRename).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("does not rename when the draft equals the current title", () => {
    const onRename = vi.fn();
    const { result } = renderHook(() => useRenameRecording("Demo", onRename));
    act(() => result.current.startEdit());
    act(() => result.current.commitEdit());
    expect(onRename).not.toHaveBeenCalled();
  });

  it("cancels without renaming", () => {
    const onRename = vi.fn();
    const { result } = renderHook(() => useRenameRecording("Demo", onRename));
    act(() => result.current.startEdit());
    act(() => result.current.setDraft("Something else"));
    act(() => result.current.cancelEdit());
    expect(onRename).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });
});
