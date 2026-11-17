import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorOpened } from "./use-editor-opened";

vi.mock("./analytics-client", () => ({ captureEvent: vi.fn() }));

import { captureEvent } from "./analytics-client";

afterEach(() => vi.clearAllMocks());

describe("useEditorOpened", () => {
  it("sends nothing while the editor is still loading", () => {
    renderHook(() => useEditorOpened("video", false));
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("sends editor_opened once, when the editor has loaded", () => {
    const { rerender } = renderHook(({ loaded }) => useEditorOpened("image", loaded), {
      initialProps: { loaded: false },
    });
    rerender({ loaded: true });
    rerender({ loaded: true });
    rerender({ loaded: false });
    rerender({ loaded: true });

    expect(captureEvent).toHaveBeenCalledTimes(1);
    expect(captureEvent).toHaveBeenCalledWith("editor_opened", { editor: "image" });
  });

  it("counts each mounted editor session on its own", () => {
    renderHook(() => useEditorOpened("video", true)).unmount();
    renderHook(() => useEditorOpened("video", true));

    expect(captureEvent).toHaveBeenCalledTimes(2);
  });
});
