import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import {
  RecordingsView,
  formatBytes,
  formatDuration,
  type RecordingRow,
  type RecordingsViewProps,
} from "./recordings-page";

afterEach(cleanup);

const ROWS: RecordingRow[] = [
  {
    id: "r1",
    title: "Payment fails on step 3",
    kind: "recording",
    status: "ready",
    durationSeconds: 134,
    sizeBytes: 48 * 1024 * 1024,
  },
  {
    id: "r2",
    title: "Turn on mentions",
    kind: "screenshot",
    status: "pending",
    durationSeconds: 0,
    sizeBytes: 1200 * 1024,
  },
];

function setup(overrides: Partial<RecordingsViewProps> = {}) {
  const props: RecordingsViewProps = {
    recordings: ROWS,
    isPending: false,
    failed: false,
    onRetry: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    opening: false,
    deleting: false,
    ...overrides,
  };
  const view = renderWithProviders(<RecordingsView {...props} />);
  return { ...props, ...view };
}

describe("formatters", () => {
  it("formats sizes and durations as the table shows them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(48 * 1024 * 1024)).toBe("48.0 MB");
    expect(formatDuration(134)).toBe("2:14");
    expect(formatDuration(0)).toBe("—");
  });
});

describe("RecordingsView", () => {
  it("lists each recording with its kind, duration and size", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Recordings" })).toBeTruthy();
    expect(screen.getByText("Files you uploaded from the desktop app.")).toBeTruthy();
    expect(screen.getByText("Payment fails on step 3")).toBeTruthy();
    expect(screen.getByText("Screenshot")).toBeTruthy();
    expect(screen.getByText("2:14")).toBeTruthy();
    expect(screen.getByText("48.0 MB")).toBeTruthy();
  });

  it("opens only ready recordings and deletes any", () => {
    const { onOpen, onDelete } = setup();
    const open = screen.getAllByRole("button", { name: "Open" });
    expect((open[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(open[0]!);
    expect(onOpen).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]!);
    expect(onDelete).toHaveBeenCalledWith("r2");
  });

  it("shows skeleton rows while loading, with no recordings", () => {
    const { container } = setup({ isPending: true, recordings: [] });
    expect(container.querySelectorAll("[data-loading]")).toHaveLength(3);
    expect(screen.queryByText("No recordings yet", { exact: false })).toBeNull();
  });

  it("shows the error with Retry when the list fails", () => {
    const { onRetry } = setup({ failed: true, recordings: [] });
    expect(screen.getByRole("alert").textContent).toContain("Failed to load recordings");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("explains where recordings come from when there are none", () => {
    setup({ recordings: [] });
    expect(
      screen.getByText(
        "No recordings yet. Capture one from the desktop app and it will show up here.",
      ),
    ).toBeTruthy();
  });
});
