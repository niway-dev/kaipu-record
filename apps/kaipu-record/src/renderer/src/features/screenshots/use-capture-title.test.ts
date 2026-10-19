import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resolveCaptureTitle, useCaptureTitle } from "./use-capture-title";

const AUTO = "Screenshot — 2026-10-07";

describe("resolveCaptureTitle", () => {
  it("trims the draft and falls back to the auto title when empty", () => {
    expect(resolveCaptureTitle("  Login bug  ", AUTO)).toBe("Login bug");
    expect(resolveCaptureTitle("", AUTO)).toBe(AUTO);
    expect(resolveCaptureTitle("   ", AUTO)).toBe(AUTO);
  });
});

describe("useCaptureTitle", () => {
  it("starts with the auto title committed and in the draft", () => {
    const { result } = renderHook(() => useCaptureTitle(AUTO, null));
    expect(result.current.title).toBe(AUTO);
    expect(result.current.draft).toBe(AUTO);
    expect(result.current.autoTitle).toBe(AUTO);
  });

  it("commits the trimmed draft as the title without renaming a fresh capture", () => {
    const { result } = renderHook(() => useCaptureTitle(AUTO, null));
    act(() => result.current.setDraft("  Login bug  "));
    act(() => result.current.commit());
    expect(result.current.title).toBe("Login bug");
    expect(result.current.draft).toBe("Login bug");
  });

  it("falls back to the auto title when the draft is emptied", () => {
    const onRename = vi.fn();
    const { result } = renderHook(() => useCaptureTitle(AUTO, onRename));
    act(() => result.current.setDraft("Login bug"));
    act(() => result.current.commit());
    act(() => result.current.setDraft("   "));
    act(() => result.current.commit());
    expect(result.current.title).toBe(AUTO);
    expect(result.current.draft).toBe(AUTO);
    expect(onRename).toHaveBeenLastCalledWith(AUTO);
  });

  it("renames a saved item on commit, only when the title changed", () => {
    const onRename = vi.fn();
    const { result } = renderHook(() => useCaptureTitle(AUTO, onRename));
    act(() => result.current.commit());
    expect(onRename).not.toHaveBeenCalled();

    act(() => result.current.setDraft("Login bug"));
    act(() => result.current.commit());
    expect(onRename).toHaveBeenCalledExactlyOnceWith("Login bug");

    // Same text again (with whitespace) — no second rename.
    act(() => result.current.setDraft(" Login bug "));
    act(() => result.current.commit());
    expect(onRename).toHaveBeenCalledOnce();
  });

  it("reverts the draft to the committed title", () => {
    const { result } = renderHook(() => useCaptureTitle(AUTO, null));
    act(() => result.current.setDraft("Login bug"));
    act(() => result.current.commit());
    act(() => result.current.setDraft("something else"));
    act(() => result.current.revert());
    expect(result.current.draft).toBe("Login bug");
    expect(result.current.title).toBe("Login bug");
  });

  it("adopts the vault's title after a save", () => {
    const onRename = vi.fn();
    const { result } = renderHook(() => useCaptureTitle(AUTO, onRename));
    act(() => result.current.adopt("Login bug (copy)"));
    expect(result.current.title).toBe("Login bug (copy)");
    expect(result.current.draft).toBe("Login bug (copy)");
    expect(onRename).not.toHaveBeenCalled();
  });
});
