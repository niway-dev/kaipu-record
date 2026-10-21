import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toLayout } from "../../timeline";
import type { MuteEditing } from "../../use-mute-editing";
import { MuteInspector } from "./mute-inspector";

const layout = toLayout([{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 30 }]);
const range = { id: "m1", sourceStart: 10, sourceEnd: 15 };

function makeMutes(): MuteEditing {
  return {
    mutedRanges: [range],
    audioMuted: false,
    addAtPlayhead: vi.fn(),
    remove: vi.fn(),
    toggleAll: vi.fn(),
    edgeDrag: vi.fn(),
  };
}

describe("MuteInspector", () => {
  it("names the range and shows where it sits on the timeline", () => {
    render(
      <MuteInspector
        range={range}
        index={2}
        layout={layout}
        mutes={makeMutes()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Muted section 2" })).toBeInTheDocument();
    // 10 s → 15 s of a single uncut clip is the same on the timeline.
    expect(screen.getByText(/0:10.*→.*0:15/)).toBeInTheDocument();
  });

  it("deletes through the editing hook and then clears the selection", () => {
    const mutes = makeMutes();
    const onRemoved = vi.fn();
    render(
      <MuteInspector range={range} index={1} layout={layout} mutes={mutes} onRemoved={onRemoved} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete this muted section" }));
    expect(mutes.remove).toHaveBeenCalledWith("m1");
    // The order matters: the panel is unmounted by the selection clearing, so the
    // removal must already have been committed.
    expect(onRemoved).toHaveBeenCalledOnce();
  });
});
