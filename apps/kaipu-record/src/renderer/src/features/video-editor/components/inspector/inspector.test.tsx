import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../../scene";
import { toLayout } from "../../timeline";
import type { ZoomEditing } from "../../zoom/use-zoom-editing";
import type { ZoomSegment } from "../../zoom/zoom-model";
import { DetectionPanel } from "./detection-panel";
import { ZoomInspector } from "./zoom-inspector";

const layout = toLayout([{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 20 }] as TrackItem[]);

const SEGMENT: ZoomSegment = {
  id: "z1",
  start: 10.2,
  end: 16,
  scale: 2.1,
  mode: "follow",
  anchor: null,
  smoothing: 70,
  origin: "auto",
  trigger: "click",
};

function zooms(partial: Partial<ZoomEditing> = {}): ZoomEditing {
  return {
    visibleZooms: [SEGMENT],
    coverage: 0.59,
    addAtPlayhead: vi.fn(),
    remove: vi.fn(),
    commitPatch: vi.fn(),
    begin: vi.fn(),
    livePatch: vi.fn(),
    end: vi.fn(),
    edgeDrag: vi.fn(),
    liveLock: vi.fn(),
    sensitivityLive: vi.fn(),
    sensitivityCommit: vi.fn(),
    reanalyse: vi.fn(),
    canDetect: true,
    ...partial,
  };
}

describe("DetectionPanel", () => {
  it("shows the summary and re-analyses", () => {
    const z = zooms();
    render(<DetectionPanel zooms={z} sensitivity={55} clicksAvailable />);
    expect(screen.getByText("1 zoom · 59% of clip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Re-analyse/ }));
    expect(z.reanalyse).toHaveBeenCalled();
  });
  it("explains the missing cursor data instead of showing dead controls", () => {
    render(
      <DetectionPanel
        zooms={zooms({ canDetect: false })}
        sensitivity={55}
        clicksAvailable={false}
      />,
    );
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText(/no cursor data/)).toBeInTheDocument();
  });
  it("hints at Accessibility when clicks are unavailable", () => {
    render(<DetectionPanel zooms={zooms()} sensitivity={55} clicksAvailable={false} />);
    expect(screen.getByText(/Accessibility access/)).toBeInTheDocument();
  });
});

describe("ZoomInspector", () => {
  it("renders header, badge, range and the two sliders", () => {
    render(
      <ZoomInspector
        segment={SEGMENT}
        index={2}
        layout={layout}
        zooms={zooms()}
        anchorNow={() => ({ x: 0.5, y: 0.5 })}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Zoom 2" })).toBeInTheDocument();
    expect(screen.getByText("CLICK DETECTED")).toBeInTheDocument();
    expect(screen.getByText("0:10.2 → 0:16.0")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Level" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Smoothness" })).toBeInTheDocument();
  });
  it("locks at the camera box's current position, not the frame centre", () => {
    const z = zooms();
    render(
      <ZoomInspector
        segment={SEGMENT}
        index={1}
        layout={layout}
        zooms={z}
        anchorNow={() => ({ x: 0.82, y: 0.31 })}
        onRemoved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Lock here/ }));
    expect(z.commitPatch).toHaveBeenCalledWith("z1", {
      mode: "fixed",
      anchor: { x: 0.82, y: 0.31 },
    });
    expect(screen.getByText(/200 ms before each click/)).toBeInTheDocument();
  });
  it("removes and clears the selection", () => {
    const z = zooms();
    const onRemoved = vi.fn();
    render(
      <ZoomInspector
        segment={SEGMENT}
        index={1}
        layout={layout}
        zooms={z}
        anchorNow={() => ({ x: 0.5, y: 0.5 })}
        onRemoved={onRemoved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove this zoom/ }));
    expect(z.remove).toHaveBeenCalledWith("z1");
    expect(onRemoved).toHaveBeenCalled();
  });
});
