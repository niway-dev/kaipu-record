import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordButton } from "./record-button";

describe("RecordButton", () => {
  it("shows Start (with shortcut) when idle and Stop when recording", () => {
    const { rerender } = render(
      <RecordButton isRecording={false} shortcut="⌘⇧P" onClick={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
    expect(screen.getByText("⌘⇧P")).toBeInTheDocument();

    rerender(<RecordButton isRecording={true} shortcut="⌘⇧P" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeInTheDocument();
    expect(screen.queryByText("⌘⇧P")).not.toBeInTheDocument();
  });

  it("is disabled when disabled and idle, but clickable otherwise", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<RecordButton isRecording={false} disabled onClick={onClick} />);
    expect(screen.getByRole("button")).toBeDisabled();

    rerender(<RecordButton isRecording={false} disabled={false} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
