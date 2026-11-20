import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initialScene } from "../../scene";
import { toLayout } from "../../timeline";
import { sourceAxis } from "../../source-axis";
import { useVideoScene, type VideoSceneController } from "../../use-video-scene";
import { useWebcamEditing, type WebcamEditing } from "../../webcam/use-webcam-editing";
import {
  WEBCAM_DEFAULTS,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
} from "../../webcam/webcam-model";
import { WebcamPanel, type WebcamPanelProps } from "./webcam-inspector";

const FRAME = { width: 1920, height: 1080 };

const PART: WebcamSegment = {
  id: "part-1",
  start: 4,
  end: 8,
  mode: "override",
  layout: { position: { x: 0.88, y: 0.18 } },
  transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
};
const HIDDEN: WebcamSegment = { id: "hidden-1", start: 10, end: 12, mode: "hidden" };

const WEBCAM_TRACK = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
} as const;

const sceneOf = (
  layout: Partial<WebcamLayout> = {},
  segments: WebcamSegment[] = [],
): WebcamScene => ({ layout: { ...WEBCAM_DEFAULTS, ...layout }, segments });

function makeEdits(): WebcamEditing {
  return {
    webcam: null,
    visibleSegments: [],
    hideAtPlayhead: vi.fn(),
    commitTransition: vi.fn(),
    liveTransition: vi.fn(),
    remove: vi.fn(),
    takeWholeLook: vi.fn(),
    edgeDrag: vi.fn(),
    commitLayout: vi.fn(),
    begin: vi.fn(),
    liveLayout: vi.fn(),
    end: vi.fn(),
  };
}

/** The panel's props with a part selected, unless a test says otherwise. */
const panelProps = (props: Partial<WebcamPanelProps> = {}): WebcamPanelProps => ({
  webcam: sceneOf({}, [PART]),
  segment: PART,
  range: { from: 4, to: 8 },
  playhead: 4,
  edits: makeEdits(),
  frame: FRAME,
  onPlaySlide: vi.fn(),
  onRemoved: vi.fn(),
  ...props,
});

function renderPanel(props: Partial<WebcamPanelProps> = {}) {
  const all = panelProps(props);
  render(<WebcamPanel {...all} />);
  return { edits: all.edits, onPlaySlide: all.onPlaySlide, onRemoved: all.onRemoved };
}

const openWholeVideo = (): void => {
  fireEvent.click(screen.getByRole("tab", { name: "Whole video" }));
};

describe("the Camera panel's tabs", () => {
  it("opens on This part and switches to Whole video and back", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Camera" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "This part" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Whole video" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    openWholeVideo();
    expect(screen.getByRole("tab", { name: "Whole video" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "This part" }));
    expect(screen.getByRole("tab", { name: "This part" })).toHaveAttribute("aria-selected", "true");
  });

  it("only the selected tab is a tab stop", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: "This part" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Whole video" })).toHaveAttribute("tabindex", "-1");
    openWholeVideo();
    expect(screen.getByRole("tab", { name: "This part" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: "Whole video" })).toHaveAttribute("tabindex", "0");
  });

  it("the arrow keys move between the tabs, wrapping, and focus follows the selection", () => {
    renderPanel();
    const part = screen.getByRole("tab", { name: "This part" });
    const whole = screen.getByRole("tab", { name: "Whole video" });
    part.focus();
    fireEvent.keyDown(part, { key: "ArrowRight" });
    expect(whole).toHaveAttribute("aria-selected", "true");
    expect(whole).toHaveFocus();
    fireEvent.keyDown(whole, { key: "ArrowRight" });
    expect(part).toHaveAttribute("aria-selected", "true");
    expect(part).toHaveFocus();
    fireEvent.keyDown(part, { key: "ArrowLeft" });
    expect(whole).toHaveAttribute("aria-selected", "true");
    expect(whole).toHaveFocus();
  });

  it("Space on a tab stays with the tab: the page's playback shortcut never sees it", () => {
    renderPanel();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      const tab = screen.getByRole("tab", { name: "Whole video" });
      tab.focus();
      const notPrevented = fireEvent.keyDown(tab, { key: " " });
      expect(onWindowKey).not.toHaveBeenCalled();
      // Not cancelled either: the browser still turns Space into the click that selects the tab.
      expect(notPrevented).toBe(true);
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("This part shows how the part arrives and ends, and none of the whole-video look", () => {
    renderPanel();
    expect(screen.getByRole("group", { name: "How it arrives" })).toBeInTheDocument();
    expect(screen.getByText("When it ends")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove this part" })).toBeInTheDocument();
    for (const name of ["Shape", "Size"]) {
      expect(screen.queryByRole("group", { name })).toBeNull();
    }
    expect(screen.queryByRole("checkbox", { name: "Mirror" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Size during zoom" })).toBeNull();
  });

  it("Whole video shows the look, and none of the part's controls", () => {
    renderPanel();
    openWholeVideo();
    expect(screen.getByRole("group", { name: "Shape" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Size" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Mirror" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Shadow" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Shrink during zoom" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "How it arrives" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove this part" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play the slide" })).toBeNull();
  });

  it("Whole video shows the original position, named, with the drag hint and no control", () => {
    renderPanel();
    openWholeVideo();
    expect(screen.getByTestId("webcam-panel-name")).toHaveTextContent("Bottom left");
    expect(screen.getByText("Drag the bubble on the video to put it anywhere.")).toBeTruthy();
    const frame = screen.getByTestId("webcam-panel-frame");
    expect(within(frame).queryAllByRole("button")).toHaveLength(0);
    expect(frame.querySelector('[data-dot="now"]')).not.toBeNull();
    // The original position comes from nowhere: no dashed "before" dot.
    expect(frame.querySelector('[data-dot="before"]')).toBeNull();
  });

  it("the tab the user picked stays while the part under the playhead changes", () => {
    const edits = makeEdits();
    const webcam = sceneOf({}, [PART]);
    const props: WebcamPanelProps = {
      webcam,
      segment: PART,
      range: { from: 4, to: 8 },
      playhead: 4,
      edits,
      frame: FRAME,
      onPlaySlide: vi.fn(),
      onRemoved: vi.fn(),
    };
    const { rerender } = render(<WebcamPanel {...props} />);
    openWholeVideo();
    rerender(<WebcamPanel {...props} segment={null} range={null} playhead={9} />);
    expect(screen.getByRole("tab", { name: "Whole video" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("This part, with a part there", () => {
  it("shows the part's range and length, its computed name and a before and now frame", () => {
    renderPanel();
    expect(screen.getByText(/0:04\.0 – 0:08\.0 · 4\.0 s/)).toBeInTheDocument();
    expect(screen.getByTestId("webcam-panel-name")).toHaveTextContent("Top right");
    expect(screen.getByText("Drag the bubble on the video to put it anywhere.")).toBeTruthy();
    const frame = screen.getByTestId("webcam-panel-frame");
    expect(frame).toHaveAccessibleName("Camera place: Top right");
    const before = frame.querySelector<HTMLElement>('[data-dot="before"]');
    const now = frame.querySelector<HTMLElement>('[data-dot="now"]');
    expect(before).not.toBeNull();
    expect(now).not.toBeNull();
    // Before is the original position (left, low); now is the part's (right, high).
    expect(parseFloat(before!.style.left)).toBeLessThan(parseFloat(now!.style.left));
    expect(parseFloat(before!.style.top)).toBeGreaterThan(parseFloat(now!.style.top));
    expect(frame.querySelector("line")).not.toBeNull();
  });

  it("shows the length of the part on the timeline, not its length in the source", () => {
    // A part of 10 source seconds (10 to 20) that spans 4 timeline seconds, e.g. over a cut.
    const part: WebcamSegment = { ...PART, start: 10, end: 20 };
    renderPanel({
      segment: part,
      webcam: sceneOf({}, [part]),
      range: { from: 10, to: 14 },
      playhead: 10,
    });
    expect(screen.getByText(/0:10\.0 – 0:14\.0 · 4\.0 s/)).toBeInTheDocument();
    expect(screen.queryByText(/10\.0 s/)).toBeNull();
  });

  it("the frame is a picture, not a control", () => {
    const { edits } = renderPanel();
    const frame = screen.getByTestId("webcam-panel-frame");
    expect(within(frame).queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(frame);
    expect(edits.commitLayout).not.toHaveBeenCalled();
    expect(edits.liveLayout).not.toHaveBeenCalled();
  });

  it("the before dot is the previous part's position when a part ends where this one starts", () => {
    const first: WebcamSegment = {
      id: "part-0",
      start: 1,
      end: 4,
      mode: "override",
      layout: { position: { x: 0.5, y: 0.5 } },
    };
    renderPanel({ webcam: sceneOf({}, [first, PART]) });
    const frame = screen.getByTestId("webcam-panel-frame");
    const before = frame.querySelector<HTMLElement>('[data-dot="before"]')!;
    expect(parseFloat(before.style.left)).toBeCloseTo(50, 0);
    expect(parseFloat(before.style.top)).toBeCloseTo(50, 0);
  });

  it("has no Position grid and no way to type a position", () => {
    renderPanel();
    expect(screen.queryByRole("group", { name: "Position" })).toBeNull();
    for (const name of ["Top left", "Top middle", "Top right", "Left", "Center", "Bottom right"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("switches the arrival to Slide and to Cut", () => {
    const edits = makeEdits();
    renderPanel({
      edits,
      webcam: sceneOf({}, [{ ...PART, transition: undefined }]),
      segment: { ...PART, transition: undefined },
    });
    expect(screen.getByRole("button", { name: "Cut" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Slide" }));
    expect(edits.commitTransition).toHaveBeenCalledWith("part-1", { kind: "slide" });
    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(edits.commitTransition).toHaveBeenLastCalledWith("part-1", { kind: "cut" });
  });

  it("a Cut has no duration, no motion and no Play the slide, and says it ends at once", () => {
    renderPanel({ segment: { ...PART, transition: { kind: "cut", ms: 700, easing: "linear" } } });
    expect(screen.queryByRole("group", { name: "Duration" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Motion" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play the slide" })).toBeNull();
    expect(screen.getByText(/goes back to the original position at once/)).toBeInTheDocument();
  });

  it("a Slide offers 0.4, 0.7 and 1.2 s and Smooth, Bounce and Linear, with the saved ones pressed", () => {
    const edits = makeEdits();
    renderPanel({ edits });
    const duration = screen.getByRole("group", { name: "Duration" });
    expect(
      within(duration)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["0.4 s", "0.7 s", "1.2 s"]);
    expect(within(duration).getByRole("button", { name: "0.7 s" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const motion = screen.getByRole("group", { name: "Motion" });
    expect(
      within(motion)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Smooth", "Bounce", "Linear"]);
    expect(within(motion).getByRole("button", { name: "Smooth" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "1.2 s" }));
    expect(edits.commitTransition).toHaveBeenCalledWith("part-1", { ms: 1200 });
    fireEvent.click(screen.getByRole("button", { name: "Bounce" }));
    expect(edits.commitTransition).toHaveBeenLastCalledWith("part-1", { easing: "back" });
    fireEvent.click(screen.getByRole("button", { name: "Linear" }));
    expect(edits.commitTransition).toHaveBeenLastCalledWith("part-1", { easing: "linear" });
  });

  it("a saved 500 ms ease-out shows no duration and no motion pressed, and opening rewrites nothing", () => {
    const edits = makeEdits();
    renderPanel({
      edits,
      segment: { ...PART, transition: { kind: "slide", ms: 500, easing: "ease-out" } },
    });
    for (const group of ["Duration", "Motion"]) {
      const buttons = within(screen.getByRole("group", { name: group })).getAllByRole("button");
      for (const button of buttons) expect(button).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByRole("button", { name: "Slide" })).toHaveAttribute("aria-pressed", "true");
    expect(edits.commitTransition).not.toHaveBeenCalled();
    expect(edits.liveTransition).not.toHaveBeenCalled();
    expect(edits.commitLayout).not.toHaveBeenCalled();
  });

  it("Play the slide asks the page to play this part", () => {
    const { onPlaySlide } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Play the slide" }));
    expect(onPlaySlide).toHaveBeenCalledWith(PART);
  });

  it("Remove this part removes it and tells the page", () => {
    const { edits, onRemoved } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Remove this part" }));
    expect(edits.remove).toHaveBeenCalledWith("part-1");
    expect(onRemoved).toHaveBeenCalledOnce();
  });
});

describe("a part saved with its own look", () => {
  const legacy = (layout: Partial<WebcamLayout>): WebcamSegment => ({
    ...PART,
    layout: { position: { x: 0.88, y: 0.18 }, ...layout },
  });
  const note = (): HTMLElement | null => screen.queryByTestId("webcam-own-look");
  const button = (): HTMLElement | null =>
    screen.queryByRole("button", { name: "Use the whole-video look" });

  it("says it has its own shape and size and offers the whole-video look", () => {
    const part = legacy({ shape: "rectangle", size: 0.33 });
    const { edits } = renderPanel({ segment: part, webcam: sceneOf({}, [part]) });
    expect(note()).toHaveTextContent("This part has its own shape and size.");
    fireEvent.click(button()!);
    expect(edits.takeWholeLook).toHaveBeenCalledTimes(1);
    expect(edits.takeWholeLook).toHaveBeenCalledWith("part-1");
    expect(edits.commitLayout).not.toHaveBeenCalled();
  });

  it("names a size alone, a shape alone and corners", () => {
    const sizeOnly = legacy({ size: 0.3 });
    const { unmount } = render(
      <WebcamPanel {...panelProps({ segment: sizeOnly, webcam: sceneOf({}, [sizeOnly]) })} />,
    );
    expect(note()).toHaveTextContent("This part has its own size.");
    unmount();
    const shapeOnly = legacy({ shape: "rounded" });
    const second = render(
      <WebcamPanel {...panelProps({ segment: shapeOnly, webcam: sceneOf({}, [shapeOnly]) })} />,
    );
    expect(note()).toHaveTextContent("This part has its own shape.");
    second.unmount();
    const all = legacy({ shape: "rounded", size: 0.3, cornerRadius: 0.5 });
    render(<WebcamPanel {...panelProps({ segment: all, webcam: sceneOf({}, [all]) })} />);
    expect(note()).toHaveTextContent("This part has its own shape, size and corners.");
  });

  it("shows neither the note nor the button for a part with only a position", () => {
    renderPanel();
    expect(note()).toBeNull();
    expect(button()).toBeNull();
  });

  it("shows them on This part only, not on Whole video", () => {
    const part = legacy({ size: 0.3 });
    renderPanel({ segment: part, webcam: sceneOf({}, [part]) });
    openWholeVideo();
    expect(note()).toBeNull();
    expect(button()).toBeNull();
  });

  it("is one undo step through the real editing path, and the note then disappears", () => {
    let controller!: VideoSceneController;
    function Harness(): React.JSX.Element {
      controller = useVideoScene(initialScene(20, { ...WEBCAM_TRACK }));
      const edits = useWebcamEditing({
        controller,
        layout: toLayout(controller.scene.items),
        axis: sourceAxis(20),
      });
      const webcam = controller.scene.webcam!;
      const segment = webcam.segments[0] ?? null;
      return (
        <WebcamPanel
          webcam={webcam}
          segment={segment}
          range={segment ? { from: segment.start, to: segment.end } : null}
          playhead={4}
          edits={edits}
          frame={FRAME}
          onPlaySlide={vi.fn()}
          onRemoved={vi.fn()}
        />
      );
    }
    const first = legacy({ shape: "rectangle", size: 0.33 });
    render(<Harness />);
    act(() => {
      const scene = controller.scene;
      controller.commit({ ...scene, webcam: { ...scene.webcam!, segments: [first] } });
    });
    expect(note()).not.toBeNull();
    fireEvent.click(button()!);
    expect(note()).toBeNull();
    expect(button()).toBeNull();
    expect(controller.scene.webcam!.segments[0]!.layout).toEqual({
      position: { x: 0.88, y: 0.18 },
    });
    act(() => controller.undo());
    expect(controller.scene.webcam!.segments[0]!.layout).toEqual(first.layout);
    expect(note()).not.toBeNull();
  });
});

describe("This part, with no part there", () => {
  it("says there is no change at the playhead and offers no button", () => {
    renderPanel({ segment: null, range: null, playhead: 4 });
    expect(screen.getByText("No change at 0:04")).toBeInTheDocument();
    expect(screen.getByText(/Drag the bubble and Kaipu asks/)).toBeInTheDocument();
    const body = screen.getByRole("tabpanel");
    expect(within(body).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Remove this part" })).toBeNull();
    expect(screen.queryByRole("group", { name: "How it arrives" })).toBeNull();
  });
});

describe("Whole video", () => {
  it("sets the shape on the whole video's layout", () => {
    const edits = makeEdits();
    renderPanel({ edits });
    openWholeVideo();
    expect(screen.getByRole("button", { name: "Circle" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Square" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ shape: "rounded" }, null);
  });

  it("offers corners for Square and Rectangle only", () => {
    const { unmount } = render(<WebcamPanel {...panelProps({ segment: null, range: null })} />);
    openWholeVideo();
    expect(screen.queryByRole("slider", { name: "Corners" })).toBeNull();
    unmount();
    const rectangle = render(
      <WebcamPanel
        {...panelProps({ webcam: sceneOf({ shape: "rectangle" }), segment: null, range: null })}
      />,
    );
    openWholeVideo();
    expect(screen.getByRole("slider", { name: "Corners" })).toBeInTheDocument();
    rectangle.unmount();
    // "rounded" is the Square shape: it has corners too.
    render(
      <WebcamPanel
        {...panelProps({ webcam: sceneOf({ shape: "rounded" }), segment: null, range: null })}
      />,
    );
    openWholeVideo();
    expect(screen.getByRole("slider", { name: "Corners" })).toBeInTheDocument();
  });

  it("toggles mirror and shadow", () => {
    const edits = makeEdits();
    renderPanel({ edits, webcam: sceneOf({ mirrored: true, shadow: false }) });
    openWholeVideo();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mirror" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ mirrored: false }, null);
    fireEvent.click(screen.getByRole("checkbox", { name: "Shadow" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ shadow: true }, null);
  });

  it("shrink during zoom is off for a new session and its checkbox turns it on at 0.7", () => {
    const edits = makeEdits();
    expect(WEBCAM_DEFAULTS.scaleDuringZoom).toBe(1);
    renderPanel({ edits, segment: null, range: null });
    openWholeVideo();
    expect(screen.getByRole("checkbox", { name: "Shrink during zoom" })).not.toBeChecked();
    expect(screen.queryByRole("slider", { name: "Size during zoom" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shrink during zoom" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ scaleDuringZoom: 0.7 }, null);
  });

  it("shrink during zoom: off is 1, on restores 0.7 and shows its slider", () => {
    const edits = makeEdits();
    const { unmount } = render(
      <WebcamPanel
        webcam={sceneOf({ scaleDuringZoom: 0.7 })}
        segment={null}
        range={null}
        playhead={0}
        edits={edits}
        frame={FRAME}
        onPlaySlide={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    openWholeVideo();
    expect(screen.getByRole("slider", { name: "Size during zoom" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shrink during zoom" }));
    expect(edits.commitLayout).toHaveBeenCalledWith({ scaleDuringZoom: 1 }, null);
    unmount();
    renderPanel({ edits, webcam: sceneOf({ scaleDuringZoom: 1 }), segment: null, range: null });
    openWholeVideo();
    expect(screen.queryByRole("slider", { name: "Size during zoom" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shrink during zoom" }));
    expect(edits.commitLayout).toHaveBeenLastCalledWith({ scaleDuringZoom: 0.7 }, null);
  });

  it("the size-during-zoom slider still works: a keyboard step commits, a drag is one gesture", () => {
    const edits = makeEdits();
    renderPanel({ edits, webcam: sceneOf({ scaleDuringZoom: 0.7 }) });
    openWholeVideo();
    const slider = screen.getByRole("slider", { name: "Size during zoom" });
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(edits.commitLayout).toHaveBeenCalledWith({ scaleDuringZoom: 0.5 }, null);
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.6" } });
    fireEvent.pointerUp(slider);
    expect(edits.begin).toHaveBeenCalledOnce();
    expect(edits.liveLayout).toHaveBeenCalledWith({ scaleDuringZoom: 0.6 }, null);
    expect(edits.end).toHaveBeenCalledOnce();
  });

  it("has no Position grid and no size slider", () => {
    renderPanel();
    openWholeVideo();
    expect(screen.queryByRole("group", { name: "Position" })).toBeNull();
    for (const name of ["Top left", "Top middle", "Top right", "Left", "Center", "Bottom right"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("slider", { name: "Size" })).toBeNull();
  });
});

describe("the S, M and L size buttons", () => {
  it("write 0.15, 0.22 and 0.33 on the whole video's layout", () => {
    const edits = makeEdits();
    renderPanel({ edits });
    openWholeVideo();
    const group = screen.getByRole("group", { name: "Size" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["S", "M", "L"]);
    fireEvent.click(within(group).getByRole("button", { name: "S" }));
    expect(edits.commitLayout).toHaveBeenLastCalledWith({ size: 0.15 }, null);
    fireEvent.click(within(group).getByRole("button", { name: "M" }));
    expect(edits.commitLayout).toHaveBeenLastCalledWith({ size: 0.22 }, null);
    fireEvent.click(within(group).getByRole("button", { name: "L" }));
    expect(edits.commitLayout).toHaveBeenLastCalledWith({ size: 0.33 }, null);
  });

  it("press the one a size equals", () => {
    renderPanel({ webcam: sceneOf({ size: 0.33 }) });
    openWholeVideo();
    const group = screen.getByRole("group", { name: "Size" });
    expect(within(group).getByRole("button", { name: "L" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(group).getByRole("button", { name: "S" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("show none pressed for a saved 0.27, and opening the panel writes nothing", () => {
    const edits = makeEdits();
    renderPanel({ edits, webcam: sceneOf({ size: 0.27 }) });
    openWholeVideo();
    const group = screen.getByRole("group", { name: "Size" });
    for (const button of within(group).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
    expect(edits.commitLayout).not.toHaveBeenCalled();
    expect(edits.liveLayout).not.toHaveBeenCalled();
  });

  it("are one undo step through the real editing path", () => {
    let controller!: VideoSceneController;
    function Harness(): React.JSX.Element {
      controller = useVideoScene(initialScene(20, { ...WEBCAM_TRACK }));
      const edits = useWebcamEditing({
        controller,
        layout: toLayout(controller.scene.items),
        axis: sourceAxis(20),
      });
      return (
        <WebcamPanel
          webcam={controller.scene.webcam!}
          segment={null}
          range={null}
          playhead={0}
          edits={edits}
          frame={FRAME}
          onPlaySlide={vi.fn()}
          onRemoved={vi.fn()}
        />
      );
    }
    render(<Harness />);
    openWholeVideo();
    expect(controller.scene.webcam!.layout.size).toBe(0.22);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Size" })).getByRole("button", { name: "L" }),
    );
    expect(controller.scene.webcam!.layout.size).toBe(0.33);
    act(() => controller.undo());
    expect(controller.scene.webcam!.layout.size).toBe(0.22);
  });
});

describe("a hidden range", () => {
  it("shows what it is, no tabs, and Show the camera again removes it", () => {
    const { edits, onRemoved } = renderPanel({
      webcam: sceneOf({}, [HIDDEN]),
      segment: HIDDEN,
      range: { from: 10, to: 12 },
    });
    expect(screen.getByRole("heading", { name: "Camera hidden" })).toBeInTheDocument();
    expect(screen.getByText(/0:10\.0 → 0:12\.0/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "The camera is not drawn here, in the preview or in the export. It hides at once, with no fade.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("group", { name: "Shape" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the camera again" }));
    expect(edits.remove).toHaveBeenCalledWith("hidden-1");
    expect(onRemoved).toHaveBeenCalledOnce();
  });
});
