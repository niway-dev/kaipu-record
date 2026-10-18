import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CaptureToastPayload } from "@shared/types/screenshot-capture";
import type { CaptureToastBridge } from "@shared/types/electron-api";
import { CaptureToast } from "./capture-toast";

const COPIED: CaptureToastPayload = {
  thumbnail: "data:image/png;base64,AAAA",
  width: 1126,
  height: 604,
  mode: "frame",
  saved: null,
  copied: true,
};

function fakeApi() {
  let listener: ((payload: CaptureToastPayload) => void) | null = null;
  const api = {
    onShow: vi.fn((callback: (payload: CaptureToastPayload) => void) => {
      listener = callback;
      return () => (listener = null);
    }),
    ready: vi.fn(),
    action: vi.fn(),
    hover: vi.fn(),
  } satisfies CaptureToastBridge;
  const show = (payload: CaptureToastPayload): void => act(() => listener?.(payload));
  return { api, show };
}

function renderToast(payload: CaptureToastPayload | null, platform: "mac" | "other" = "mac") {
  const { api, show } = fakeApi();
  const utils = render(<CaptureToast api={api} platform={platform} />);
  if (payload) show(payload);
  return { api, show, ...utils };
}

describe("CaptureToast", () => {
  afterEach(cleanup);

  it("subscribes before telling main it is ready, and renders nothing until a payload lands", () => {
    const { api, container } = renderToast(null);
    expect(api.onShow).toHaveBeenCalledTimes(1);
    expect(api.ready).toHaveBeenCalledTimes(1);
    expect(api.onShow.mock.invocationCallOrder[0]).toBeLessThan(
      api.ready.mock.invocationCallOrder[0]!,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("a copy-only capture: copied title, paste hint, Save to Library and 'Not saved yet'", () => {
    const { container } = renderToast(COPIED);
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
    expect(screen.getByText("1126 × 604 · Frame · paste with ⌘V")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save to Library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in Library" })).not.toBeInTheDocument();
    expect(screen.getByText("Auto-hides in 6 s · Not saved yet")).toBeInTheDocument();
    // Decorative: the title says what it is.
    expect(container.querySelector("img")).toHaveAttribute("src", COPIED.thumbnail);
  });

  it("copied and saved: Open in Library and 'Also saved to your Library'", () => {
    renderToast({ ...COPIED, saved: { id: "screenshot-1" } });
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in Library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to Library" })).not.toBeInTheDocument();
    expect(screen.getByText("Auto-hides in 6 s · Also saved to your Library")).toBeInTheDocument();
  });

  it("saved only: saved title and no paste hint", () => {
    renderToast({ ...COPIED, mode: "window", saved: { id: "screenshot-1" }, copied: false });
    expect(screen.getByText("Saved to Library")).toBeInTheDocument();
    expect(screen.getByText("1126 × 604 · Window")).toBeInTheDocument();
    expect(screen.queryByText(/paste with/)).not.toBeInTheDocument();
    expect(screen.getByText("Auto-hides in 6 s")).toBeInTheDocument();
  });

  it("prints Ctrl+V off macOS", () => {
    renderToast(COPIED, "other");
    expect(screen.getByText("1126 × 604 · Frame · paste with Ctrl+V")).toBeInTheDocument();
  });

  it("turns Save to Library into Open in Library when main re-sends the payload", () => {
    const { show } = renderToast(COPIED);
    show({ ...COPIED, saved: { id: "screenshot-new" } });
    expect(screen.getByRole("button", { name: "Open in Library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to Library" })).not.toBeInTheDocument();
  });

  it("pauses the auto-hide while the pointer is over the card", () => {
    const { api } = renderToast(COPIED);
    const card = screen.getByRole("status");
    fireEvent.pointerEnter(card);
    expect(api.hover).toHaveBeenLastCalledWith(true);
    fireEvent.pointerLeave(card);
    expect(api.hover).toHaveBeenLastCalledWith(false);
  });

  it("sends the right action for every button", () => {
    const { api, show } = renderToast(COPIED);
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    expect(api.action).toHaveBeenLastCalledWith("annotate");
    fireEvent.click(screen.getByRole("button", { name: "Save to Library" }));
    expect(api.action).toHaveBeenLastCalledWith("save");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(api.action).toHaveBeenLastCalledWith("dismiss");

    show({ ...COPIED, saved: { id: "screenshot-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Open in Library" }));
    expect(api.action).toHaveBeenLastCalledWith("open-library");
  });
});
