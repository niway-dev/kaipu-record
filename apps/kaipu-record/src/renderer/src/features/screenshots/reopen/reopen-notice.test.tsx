import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITABLE_NOTICE_MS, ReopenNotice } from "./reopen-notice";

// Noon in the local timezone on Nov 11: the component formats the day in local time,
// so a fixed UTC instant would read as Nov 12 in zones such as UTC+12 to UTC+14.
const SAVED_AT = new Date(2026, 10, 11, 12, 0, 0).getTime();

describe("ReopenNotice, editable (I1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says everything is editable, with the saved day and time in mono capitals", () => {
    render(<ReopenNotice kind="editable" savedAt={SAVED_AT} edited={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reopened with everything editable");
    expect(screen.getByText(/^SAVED NOV 11 · \d\d:\d\d$/)).toBeInTheDocument();
  });

  it("leaves the date out when the saved time is unknown", () => {
    render(<ReopenNotice kind="editable" savedAt={null} edited={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reopened with everything editable");
    expect(screen.queryByText(/SAVED/)).toBeNull();
  });

  it("has no close button", () => {
    render(<ReopenNotice kind="editable" savedAt={SAVED_AT} edited={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fades out, then disappears, after about four seconds", () => {
    render(<ReopenNotice kind="editable" savedAt={SAVED_AT} edited={false} />);
    act(() => void vi.advanceTimersByTime(EDITABLE_NOTICE_MS - 500));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByRole("status").className).toMatch(/leaving/);
    act(() => void vi.advanceTimersByTime(350));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disappears on the first edit", () => {
    const { rerender } = render(<ReopenNotice kind="editable" savedAt={SAVED_AT} edited={false} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<ReopenNotice kind="editable" savedAt={SAVED_AT} edited />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ReopenNotice, flat (I2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("explains the flat image and stays however long it is left alone", () => {
    render(<ReopenNotice kind="flat" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Opened as a flat image. The earlier drawings are part of it now and can no longer be moved.",
    );
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("goes away when dismissed", () => {
    render(<ReopenNotice kind="flat" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ReopenNotice, not downloaded", () => {
  it("says the document is not downloaded and how to get it, and can be dismissed", () => {
    render(<ReopenNotice kind="evicted" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not downloaded: download it in Finder to open it here.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
