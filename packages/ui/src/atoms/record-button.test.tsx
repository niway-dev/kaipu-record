import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordButton } from "./record-button";

describe("RecordButton", () => {
  it("renders the label it is given", () => {
    render(
      <RecordButton isRecording={false} onClick={() => {}}>
        Start recording
      </RecordButton>,
    );
    expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
  });

  it("shows the shortcut only while idle", () => {
    const { rerender } = render(
      <RecordButton isRecording={false} shortcut="⌘⇧P" onClick={() => {}}>
        Start
      </RecordButton>,
    );
    expect(screen.getByText("⌘⇧P")).toBeInTheDocument();

    rerender(
      <RecordButton isRecording shortcut="⌘⇧P" onClick={() => {}}>
        Stop
      </RecordButton>,
    );
    expect(screen.queryByText("⌘⇧P")).not.toBeInTheDocument();
  });

  it("is disabled when asked and idle", () => {
    render(
      <RecordButton isRecording={false} disabled onClick={() => {}}>
        Start
      </RecordButton>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is never disabled while recording, so it can always be stopped", () => {
    render(
      <RecordButton isRecording disabled onClick={() => {}}>
        Stop
      </RecordButton>,
    );
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("fires onClick, and does not while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <RecordButton isRecording={false} onClick={onClick}>
        Start
      </RecordButton>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <RecordButton isRecording={false} disabled onClick={onClick}>
        Start
      </RecordButton>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks the recording state so a stylesheet or test can find it", () => {
    const { rerender } = render(
      <RecordButton isRecording={false} onClick={() => {}}>
        Start
      </RecordButton>,
    );
    expect(screen.getByRole("button")).not.toHaveAttribute("data-recording");

    rerender(
      <RecordButton isRecording onClick={() => {}}>
        Stop
      </RecordButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-recording", "true");
  });

  it("styles the compact variant differently from the full one", () => {
    const { rerender } = render(
      <RecordButton isRecording={false} onClick={() => {}}>
        Start
      </RecordButton>,
    );
    const full = screen.getByRole("button").className;

    rerender(
      <RecordButton isRecording={false} variant="compact" onClick={() => {}}>
        Start
      </RecordButton>,
    );
    expect(screen.getByRole("button").className).not.toBe(full);
  });
});
