import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorPage, type VideoEditorSource } from "./video-editor-page";

// jsdom's Image never fires onload for blob: URLs (no real image decoding) — the
// slide asset store's put() would hang forever without a controllable fake. Same
// approach as slide-assets.test.ts.
const FIXTURE_W = 640;
const FIXTURE_H = 480;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = "";

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      this.naturalWidth = FIXTURE_W;
      this.naturalHeight = FIXTURE_H;
      this.onload?.();
    });
  }
}

const SOURCE: VideoEditorSource = { id: "rec-1", title: "My recording", durationSeconds: 30 };

function renderEditor(): void {
  const router = createMemoryRouter([{ path: "/", element: <VideoEditorPage /> }], {
    initialEntries: [{ pathname: "/", state: SOURCE }],
  });
  render(<RouterProvider router={router} />);
}

describe("VideoEditorPage — add-image wiring", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("inserts a new image slide at the boundary nearest the playhead (index 0 at t=0)", async () => {
    renderEditor();

    // VideoEditorLoader runs an async session IPC call before rendering the real editor —
    // wait for the footer (which only appears after the load resolves) rather than
    // querying it synchronously, which would race the Promise.
    await waitFor(() => {
      expect(document.querySelector("footer")).not.toBeNull();
    });

    // Starting scene is a single clip covering the whole recording — one track block.
    const footer = document.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer!.querySelectorAll("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Agregar imagen" }));
    const input = screen.getByTestId("slide-image-input") as HTMLInputElement;
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });

    // handleAddImage is async (file.arrayBuffer() -> store.put() -> commit()); wait
    // for the new track block to land in the DOM.
    await waitFor(() => {
      expect(footer!.querySelectorAll("button")).toHaveLength(2);
    });

    const blocks = footer!.querySelectorAll("button");
    // Playhead is at 0, so boundaryIndexAt lands the slide at index 0 — the first
    // block. Only a slide block renders an <img> (its picture) and the ImagePlus
    // badge icon; a plain clip block with no decoded thumbnails renders neither.
    expect(blocks[0].querySelector("img")).not.toBeNull();
    expect(blocks[0].querySelector("svg")).not.toBeNull();
    expect(blocks[1].querySelector("img")).toBeNull();
    expect(blocks[1].querySelector("svg")).toBeNull();
  });
});
