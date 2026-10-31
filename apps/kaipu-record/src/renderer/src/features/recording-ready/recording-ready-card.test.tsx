import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RecordingReadyPayload } from "@shared/types/recording-ready";
import type { RecordingReadyCardBridge } from "@shared/types/electron-api";
import { RecordingReadyCard } from "./recording-ready-card";

const FRESH: RecordingReadyPayload = {
  assetId: "asset-1",
  durationSeconds: 78,
  dimensions: { width: 2560, height: 1440 },
  sizeBytes: 4_000_000,
  canEdit: true,
};

const CARD = { name: "Your video is ready" };

function renderCard(payload: RecordingReadyPayload | null) {
  let listener: ((payload: RecordingReadyPayload) => void) | null = null;
  const api = {
    onShow: vi.fn((callback: (payload: RecordingReadyPayload) => void) => {
      listener = callback;
      return () => (listener = null);
    }),
    ready: vi.fn(),
    action: vi.fn(),
    resize: vi.fn(),
  } satisfies RecordingReadyCardBridge;
  const show = (next: RecordingReadyPayload): void => act(() => listener?.(next));
  const utils = render(<RecordingReadyCard api={api} />);
  if (payload) show(payload);
  return { api, show, ...utils };
}

describe("RecordingReadyCard", () => {
  afterEach(cleanup);

  it("subscribes before telling main it is ready, and renders nothing until a payload lands", () => {
    const { api, container } = renderCard(null);
    expect(api.onShow.mock.invocationCallOrder[0]).toBeLessThan(
      api.ready.mock.invocationCallOrder[0]!,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the same card as the app: title, master tag, numbers, question, chips, footer", () => {
    renderCard(FRESH);
    const card = screen.getByRole("region", CARD);
    expect(within(card).getByText("Master · full quality")).toBeVisible();
    expect(within(card).getByText("1:18 · 2560 × 1440 · 4.0 MB")).toBeVisible();
    expect(within(card).getByText(/Where do you want to send it\?/)).toBeVisible();
    for (const name of ["YouTube", "TikTok", "GitHub"]) {
      expect(
        within(card).getByRole("button", { name: `Prepare a copy for ${name}` }),
      ).toBeVisible();
    }
    expect(within(card).getByRole("button", { name: "More places" })).toBeVisible();
    expect(within(card).getByRole("button", { name: "Edit first" })).toBeVisible();
    expect(within(card).getByRole("button", { name: "Open" })).toBeVisible();
    expect(within(card).getByText(/Saved at full quality/)).toBeVisible();
  });

  it("reports every press to main as a typed action", () => {
    const { api } = renderCard(FRESH);
    fireEvent.click(screen.getByRole("button", { name: "Prepare a copy for TikTok" }));
    fireEvent.click(screen.getByRole("button", { name: "More places" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit first" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(api.action.mock.calls.map(([action]) => action)).toEqual([
      { kind: "pick", destination: "vertical" },
      { kind: "pick", destination: null },
      { kind: "edit" },
      { kind: "open" },
      { kind: "dismiss" },
    ]);
  });

  it("Escape closes it", () => {
    const { api } = renderCard(FRESH);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(api.action).toHaveBeenCalledWith({ kind: "dismiss" });
  });

  it("has no Edit first for a recording the editor cannot open, nor dimensions it could not read", () => {
    renderCard({ ...FRESH, canEdit: false, dimensions: null });
    expect(screen.queryByRole("button", { name: "Edit first" })).toBeNull();
    expect(screen.getByText("1:18 · 4.0 MB")).toBeVisible();
  });

  it("a new payload replaces the card", () => {
    const { show } = renderCard(FRESH);
    show({ ...FRESH, assetId: "asset-2", durationSeconds: 5, sizeBytes: 1_000_000 });
    expect(screen.getAllByRole("region", CARD)).toHaveLength(1);
    expect(screen.getByText("0:05 · 2560 × 1440 · 1.0 MB")).toBeVisible();
  });
});
