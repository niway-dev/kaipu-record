import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { clipRecordings, type RecordingInfo } from "../clip-recordings";
import type { SceneSource, TrackItem } from "../scene";
import { sourceAxis } from "../source-axis";
import { toLayout } from "../timeline";
import type { PreviewPlayback } from "../use-preview-playback";
import { TimelineStrip } from "./timeline-strip";

// Two recordings, clips alternating A, B, A (ADR 0058): the opened recording is [0, 30], the
// joined one [3600, 3630].
const joined: SceneSource = {
  id: "src-b",
  assetId: "asset-b",
  title: "Checkout bug",
  offset: 3600,
  durationSeconds: 30,
  width: 1920,
  height: 1080,
};
const axis = sourceAxis(30, [joined]);
const items: TrackItem[] = [
  { id: "a1", kind: "clip", sourceStart: 0, sourceEnd: 14 },
  { id: "b1", kind: "clip", sourceStart: 3600, sourceEnd: 3606 },
  { id: "a2", kind: "clip", sourceStart: 14, sourceEnd: 25 },
];
const layout = toLayout(items);

const infos = (over: Partial<RecordingInfo> = {}): RecordingInfo[] => [
  { sourceId: null, title: "Onboarding demo", status: "ready", hasWebcam: false },
  { sourceId: "src-b", title: "Checkout bug", status: "ready", hasWebcam: false, ...over },
];

function playback(): PreviewPlayback {
  return {
    videoRef: { current: null },
    playing: false,
    muted: false,
    speed: 1,
    duration: 31,
    timelineTime: 0,
    readTimelineTime: () => 0,
    activeSlideId: null,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    toggleMute: vi.fn(),
    setSpeed: vi.fn(),
    seek: vi.fn(),
    onVideoTimeUpdate: vi.fn(),
    onVideoEnded: vi.fn(),
    onVideoLoadedMetadata: vi.fn(),
    onVideoPlay: vi.fn(),
    onVideoPause: vi.fn(),
    subscribeTime: vi.fn(() => () => {}),
  };
}

function renderStrip(
  over: Partial<RecordingInfo> | null,
  props: Partial<React.ComponentProps<typeof TimelineStrip>> = {},
) {
  return render(
    <TimelineStrip
      layout={layout}
      playback={playback()}
      thumbnails={[{ sourceTime: 7, url: "opened-7.jpg" }]}
      clipRecordings={over === null ? null : clipRecordings(layout, axis, infos(over))}
      selectedItemId={null}
      onSelectItem={vi.fn()}
      overlays={[]}
      selectedOverlayId={null}
      onSelectOverlay={vi.fn()}
      {...props}
    />,
  );
}

const blocks = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>("button")].filter((b) => b.closest("[class*=track]"));

describe("TimelineStrip with joined recordings", () => {
  it("labels each clip with its recording's name and the clip's length", () => {
    const { container } = renderStrip({});
    const labels = [...container.querySelectorAll('[data-testid="clip-label"]')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["Onboarding demo14.0 s", "Checkout bug6.0 s", "Onboarding demo11.0 s"]);
  });

  it("draws no label, outline or divider for a scene without joins", () => {
    const { container } = renderStrip(null);
    expect(container.querySelector('[data-testid="clip-label"]')).toBeNull();
    expect(container.querySelector('[data-testid="recording-divider"]')).toBeNull();
    const [first] = blocks(container);
    fireEvent.pointerEnter(first);
    expect(container.querySelector("[data-same-recording]")).toBeNull();
  });

  it("draws a joined clip from its own file at the recording's LOCAL seconds", () => {
    // The clip's middle is axis 3603 = local 3: the early frame, not the nearest to 3603.
    const { container } = renderStrip(
      {},
      {
        recordingThumbnails: new Map([
          [
            "src-b",
            [
              { sourceTime: 4, url: "joined-early.jpg" },
              { sourceTime: 20, url: "joined-late.jpg" },
            ],
          ],
        ]),
      },
    );
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toContain("joined-early.jpg");
    expect(srcs).not.toContain("joined-late.jpg");
    // The opened recording's clips still use the opened recording's frames.
    expect(srcs).toContain("opened-7.jpg");
  });

  it("outlines every clip of the hovered clip's recording, and clears on leave", () => {
    const { container } = renderStrip({});
    const [a1, b1, a2] = blocks(container);
    fireEvent.pointerEnter(a1);
    expect(a1.dataset.sameRecording).toBe("true");
    expect(a2.dataset.sameRecording).toBe("true");
    expect(b1.dataset.sameRecording).toBeUndefined();
    fireEvent.pointerLeave(a1);
    expect(container.querySelector("[data-same-recording]")).toBeNull();
  });

  it("shows 'Recording missing' instead of thumbnails for a missing recording", () => {
    const { container } = renderStrip({ status: "missing" });
    const [, b1] = blocks(container);
    expect(b1.dataset.recordingMissing).toBe("true");
    expect(b1.textContent).toBe("Recording missing: Checkout bug");
    expect(b1.querySelector("img")).toBeNull();
  });

  it("treats a loading recording as an empty filmstrip, not as missing", () => {
    const { container } = renderStrip({ status: "loading" });
    const [, b1] = blocks(container);
    expect(b1.dataset.recordingMissing).toBeUndefined();
    expect(b1.textContent).toContain("Checkout bug");
    expect(b1.querySelector("img")).toBeNull();
  });

  it("puts a divider where one recording hands over to another", () => {
    const { container } = renderStrip({});
    const dividers = container.querySelectorAll<HTMLElement>('[data-testid="recording-divider"]');
    expect(dividers).toHaveLength(2);
    expect(dividers[0].style.left).toBe(`${(14 / 31) * 100}%`);
  });
});
