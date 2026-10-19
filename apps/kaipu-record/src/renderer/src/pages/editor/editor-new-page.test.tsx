import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorNewPage } from "./editor-new-page";

// jsdom cannot decode images; the decoder is covered by the app, and here only
// which bytes reach the editor matters.
const decoded = { png: new ArrayBuffer(3), width: 30, height: 20 };
vi.mock("@renderer/features/editor/paste-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/editor/paste-image")>()),
  decodeToPng: vi.fn(async () => decoded),
}));

const fromMain = { png: new ArrayBuffer(5), width: 50, height: 40 };

function renderNew() {
  const router = createMemoryRouter(
    [
      { path: "/editor", element: <div>editor-home</div> },
      { path: "/editor/new", element: <EditorNewPage /> },
      { path: "/editor/capture", element: <div>editor-capture</div> },
    ],
    { initialEntries: ["/editor", "/editor/new"], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** A paste event as Chromium dispatches it, carrying `items`. */
function paste(items: Array<{ kind: string; type: string; file?: File }>): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })),
    },
  });
  act(() => {
    document.dispatchEvent(event);
  });
}

describe("EditorNewPage", () => {
  beforeEach(() => {
    window.electronAPI.readClipboardImage = vi.fn(async () => fromMain);
  });

  it("opens the image editor on the clipboard image, marked as pasted", async () => {
    const router = renderNew();
    fireEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/capture"));
    expect(router.state.location.state).toMatchObject({
      kind: "blob",
      origin: "paste",
      bytes: fromMain.png,
      width: 50,
      height: 40,
      title: expect.stringMatching(/^Pasted image — /),
    });
  });

  it("takes the New page's place, so Back from the editor skips it", async () => {
    const router = renderNew();
    fireEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/capture"));

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/editor");
  });

  it("says so, and stays, when the clipboard holds no image", async () => {
    window.electronAPI.readClipboardImage = vi.fn(async () => null);
    const router = renderNew();
    fireEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no image on the clipboard/);
    expect(router.state.location.pathname).toBe("/editor/new");
  });

  it("opens the image a ⌘V paste carries, decoded to PNG", async () => {
    const router = renderNew();
    paste([{ kind: "file", type: "image/jpeg", file: new File(["x"], "photo.jpg") }]);

    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/capture"));
    expect(router.state.location.state).toMatchObject({ bytes: decoded.png, origin: "paste" });
    expect(window.electronAPI.readClipboardImage).not.toHaveBeenCalled();
  });

  it("falls back to the native clipboard when a ⌘V paste carries no image", async () => {
    const router = renderNew();
    paste([{ kind: "string", type: "text/plain" }]);

    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/capture"));
    expect(router.state.location.state).toMatchObject({ bytes: fromMain.png });
  });
});
