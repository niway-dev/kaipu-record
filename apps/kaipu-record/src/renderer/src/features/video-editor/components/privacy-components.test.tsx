import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BlurRedaction, CoverRedaction } from "../privacy/redaction";
import type { RedactionEditing } from "../privacy/use-redaction-editing";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import { BlurInspector } from "./inspector/blur-inspector";
import { CoverInspector } from "./inspector/cover-inspector";
import { PrivacyLane } from "./privacy-lane";
import { RedactionLayer } from "./redaction-layer";
import { RegionDrawer } from "./region-drawer";
import { RegionEditor } from "./region-editor";

const layout = toLayout([
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
] as TrackItem[]);

const BLUR: BlurRedaction = {
  id: "b1",
  kind: "blur",
  start: 1,
  end: 3,
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
  intensity: 70,
  style: "gaussian",
};
const COVER: CoverRedaction = {
  id: "c1",
  kind: "cover",
  start: 4,
  end: 12,
  rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
  fill: "#18181b",
  label: "API key",
};

function rect(el: Element, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function videoAt(t: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "currentTime", { value: t, writable: true });
  return video;
}

function edits(partial: Partial<RedactionEditing> = {}): RedactionEditing {
  return {
    visibleRedactions: [],
    windowAt: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    commitPatch: vi.fn(),
    begin: vi.fn(),
    livePatch: vi.fn(),
    end: vi.fn(),
    edgeDrag: vi.fn(),
    ...partial,
  };
}

describe("PrivacyLane", () => {
  it("splits a cover across a cut, labels it, and shows the ghost", () => {
    const { container } = render(
      <PrivacyLane
        redactions={[BLUR, COVER]}
        layout={layout}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
        ghost={{ kind: "blur", start: 12, end: 14 }}
      />,
    );
    expect(container.querySelectorAll('[data-redaction-block="c1"]')).toHaveLength(2);
    expect(screen.getAllByText("API key")).toHaveLength(2);
    expect(screen.getByText("BLUR")).toBeInTheDocument();
    expect(screen.getByText("NEW BLUR")).toBeInTheDocument();
  });

  it("aborts an edge drag on pointercancel without a second 'end' from lostpointercapture", () => {
    const onEdgeDrag = vi.fn();
    const { container } = render(
      <PrivacyLane
        redactions={[COVER]}
        layout={layout}
        selectedId="c1"
        onSelect={vi.fn()}
        onEdgeDrag={onEdgeDrag}
        ghost={null}
      />,
    );
    const handle = container.querySelector('[data-privacy-handle="start"]')!;
    rect(handle, 10, 10);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onEdgeDrag).toHaveBeenCalledWith("c1", "start", 4, "start");
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onEdgeDrag).toHaveBeenCalledWith("c1", "start", null, "end");
    onEdgeDrag.mockClear();
    // A trailing lostpointercapture after the cancel must not fire a second "end".
    fireEvent(handle, new Event("lostpointercapture", { bubbles: true }));
    expect(onEdgeDrag).not.toHaveBeenCalled();
  });
});

describe("RedactionLayer", () => {
  it("shows a region only while the source time is inside its window", () => {
    const video = videoAt(2);
    const { container } = render(
      <RedactionLayer redactions={[BLUR]} videoRef={{ current: video }} hidden={false} />,
    );
    const el = container.querySelector('[data-redaction-id="b1"]') as HTMLElement;
    expect(el.style.display).toBe("");
    video.currentTime = 3.2;
    video.dispatchEvent(new Event("seeked"));
    expect(el.style.display).toBe("none");
  });
  it("hides everything while the original is held", () => {
    const { container } = render(
      <RedactionLayer redactions={[BLUR]} videoRef={{ current: videoAt(2) }} hidden />,
    );
    expect((container.querySelector('[data-redaction-id="b1"]') as HTMLElement).style.display).toBe(
      "none",
    );
  });
  it("renders a cover with its fill and label", () => {
    render(
      <RedactionLayer redactions={[COVER]} videoRef={{ current: videoAt(4.5) }} hidden={false} />,
    );
    expect(screen.getByText("API key")).toBeInTheDocument();
  });
});

describe("RegionDrawer", () => {
  it("draws, shows the badges, and creates on release", () => {
    const onCreate = vi.fn();
    const onDraft = vi.fn();
    const video = videoAt(1);
    Object.defineProperty(video, "videoWidth", { value: 2000 });
    Object.defineProperty(video, "videoHeight", { value: 1000 });
    render(
      <RegionDrawer
        kind="blur"
        videoRef={{ current: video }}
        range={{ from: "0:12.0", to: "0:17.0" }}
        onDraft={onDraft}
        onCreate={onCreate}
      />,
    );
    const surface = screen.getByTestId("region-drawer");
    rect(surface, 1000, 500);
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 700, clientY: 150 });
    expect(screen.getByText("1200 × 100 · BLUR")).toBeInTheDocument();
    expect(screen.getByText("RELEASE TO ADD · 0:12.0 → 0:17.0")).toBeInTheDocument();
    fireEvent.pointerUp(surface, { pointerId: 1 });
    const created = onCreate.mock.calls[0][0];
    expect(created.x).toBeCloseTo(0.1, 9);
    expect(created.y).toBeCloseTo(0.2, 9);
    expect(created.w).toBeCloseTo(0.6, 9);
    expect(created.h).toBeCloseTo(0.1, 9);
    expect(onDraft).toHaveBeenLastCalledWith(null);
  });
  it("ignores a click without a drag", () => {
    const onCreate = vi.fn();
    render(
      <RegionDrawer
        kind="cover"
        videoRef={{ current: videoAt(1) }}
        range={null}
        onDraft={vi.fn()}
        onCreate={onCreate}
      />,
    );
    const surface = screen.getByTestId("region-drawer");
    rect(surface, 1000, 500);
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("discards the draft on pointercancel instead of creating a region", () => {
    const onCreate = vi.fn();
    const onDraft = vi.fn();
    render(
      <RegionDrawer
        kind="blur"
        videoRef={{ current: videoAt(1) }}
        range={null}
        onDraft={onDraft}
        onCreate={onCreate}
      />,
    );
    const surface = screen.getByTestId("region-drawer");
    rect(surface, 1000, 500);
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 700, clientY: 150 });
    fireEvent.pointerCancel(surface, { pointerId: 1 });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onDraft).toHaveBeenLastCalledWith(null);
    // A subsequent pointerup (stray, after the cancel already reset state) creates nothing.
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("RegionEditor", () => {
  it("moves the region as one gesture", () => {
    const onBegin = vi.fn();
    const onChange = vi.fn();
    const onEnd = vi.fn();
    const { container } = render(
      <div>
        <RegionEditor rect={BLUR.rect} onBegin={onBegin} onChange={onChange} onEnd={onEnd} />
      </div>,
    );
    rect(container.firstElementChild!, 1000, 500);
    const box = screen.getByTestId("region-editor");
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 200, clientY: 125 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 300, clientY: 125 });
    fireEvent.pointerUp(box, { pointerId: 1 });
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls.at(-1)![0].x).toBeCloseTo(0.2, 9);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
  it("resizes from a corner", () => {
    const onChange = vi.fn();
    const { container } = render(
      <div>
        <RegionEditor rect={BLUR.rect} onBegin={vi.fn()} onChange={onChange} onEnd={vi.fn()} />
      </div>,
    );
    rect(container.firstElementChild!, 1000, 500);
    const handle = container.querySelector('[data-region-handle="se"]')!;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400, clientY: 150 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600, clientY: 250 });
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.w).toBeCloseTo(0.5, 9);
    expect(next.h).toBeCloseTo(0.3, 9);
  });
  it("ends the drag exactly once when pointercancel follows a stolen capture", () => {
    const onEnd = vi.fn();
    const { container } = render(
      <div>
        <RegionEditor rect={BLUR.rect} onBegin={vi.fn()} onChange={vi.fn()} onEnd={onEnd} />
      </div>,
    );
    rect(container.firstElementChild!, 1000, 500);
    const box = screen.getByTestId("region-editor");
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 200, clientY: 125 });
    fireEvent.pointerCancel(box, { pointerId: 1 });
    expect(onEnd).toHaveBeenCalledTimes(1);
    // A trailing lostpointercapture after the cancel must not fire onEnd a second time.
    fireEvent(box, new Event("lostpointercapture", { bubbles: true }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("Blur / Cover inspectors", () => {
  it("blur: switches style with a commit and removes", () => {
    const e = edits();
    const onRemoved = vi.fn();
    render(
      <BlurInspector redaction={BLUR} range={{ from: 1, to: 3 }} edits={e} onRemoved={onRemoved} />,
    );
    expect(screen.getByText(/Minimum 40/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));
    expect(e.commitPatch).toHaveBeenCalledWith("b1", { style: "pixelate" });
    fireEvent.click(screen.getByRole("button", { name: /Remove region/ }));
    expect(e.remove).toHaveBeenCalledWith("b1");
    expect(onRemoved).toHaveBeenCalled();
  });
  it("blur: the slider cannot go below 40", () => {
    render(
      <BlurInspector
        redaction={BLUR}
        range={{ from: 1, to: 3 }}
        edits={edits()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("min", "40");
  });
  it("cover: picks a fill and commits the label once on Enter", () => {
    const e = edits();
    render(
      <CoverInspector
        redaction={COVER}
        range={{ from: 4, to: 12 }}
        edits={e}
        onRemoved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "#F6055C" }));
    expect(e.commitPatch).toHaveBeenCalledWith("c1", { fill: "#F6055C" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Token" } });
    fireEvent.change(input, { target: { value: "Token hidden" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(e.commitPatch).toHaveBeenCalledWith("c1", { label: "Token hidden" });
    expect(
      (e.commitPatch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => "label" in c[1]),
    ).toHaveLength(1);
  });
});
