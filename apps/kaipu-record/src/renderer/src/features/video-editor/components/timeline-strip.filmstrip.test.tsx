import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipRecordings, type RecordingInfo } from "../clip-recordings";
import type { SceneSource, TrackItem } from "../scene";
import { sourceAxis } from "../source-axis";
import { toLayout } from "../timeline";
import type { PreviewPlayback } from "../use-preview-playback";
import { PUBLISH_MS } from "../filmstrip-store";
import { __resetFilmstripStoreForTests, getFilmstripStore } from "../filmstrip-service";
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

class InstantImage {
  src = "";
  decode(): Promise<void> {
    return Promise.resolve();
  }
}

let urls = 0;
beforeEach(() => {
  urls = 0;
  vi.stubGlobal("Image", InstantImage);
  URL.createObjectURL = vi.fn(() => `blob:frame-${urls++}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  __resetFilmstripStoreForTests();
  vi.unstubAllGlobals();
});

const OPENED_KEY = "kaipu-media://recording/opened";
const JOINED_KEY = "kaipu-media://recording/joined";
const files = new Map<string | null, string>([
  [null, OPENED_KEY],
  ["src-b", JOINED_KEY],
]);

/** Adds frames, then waits out the store's publish throttle so the tiles see all of them. */
async function storeFrames(fileKey: string, from: number, to: number): Promise<void> {
  await act(async () => {
    for (let t = from; t <= to; t += 0.5) {
      getFilmstripStore().add(fileKey, { timestamp: t, blob: new Blob(["x"]), bytes: 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, PUBLISH_MS + 50));
  });
}

/** Tiles showing a decoded frame (an object URL), not one of today's 24 stand-ins. */
const decodedTiles = (container: HTMLElement): HTMLImageElement[] =>
  [...container.querySelectorAll<HTMLImageElement>("img[data-filmstrip-frame]")].filter((img) =>
    (img.getAttribute("src") ?? "").startsWith("blob:"),
  );

const stripImages = (container: HTMLElement): HTMLImageElement[] => [
  ...container.querySelectorAll<HTMLImageElement>("img"),
];

describe("TimelineStrip filmstrip (NIW2-844, flag zoom-filmstrip)", () => {
  it("AC11: without filmstripFiles it draws today's frames and no filmstrip attribute", async () => {
    const { container } = renderStrip({});
    await storeFrames(OPENED_KEY, 0, 25); // the flag-off strip never looks at the store
    const images = stripImages(container);
    expect(images.length).toBeGreaterThan(0);
    expect(images.map((i) => i.getAttribute("src"))).toContain("opened-7.jpg");
    expect(container.querySelector("[data-filmstrip-frame]")).toBeNull();
  });

  it("draws a tile from the decoded frame of its own time, per file", async () => {
    const { container } = renderStrip({}, { filmstripFiles: files });
    await storeFrames(OPENED_KEY, 0, 25);
    // The joined clip covers file time [0, 6] of the second recording (axis 3600..3606).
    await storeFrames(JOINED_KEY, 0, 6);
    const framed = decodedTiles(container);
    expect(framed.length).toBeGreaterThan(0);
    for (const img of framed) {
      const [start, end] = (img.getAttribute("data-filmstrip-span") ?? "").split(",").map(Number);
      const frame = Number(img.getAttribute("data-filmstrip-frame"));
      expect(frame).toBeGreaterThanOrEqual(start);
      expect(frame).toBeLessThanOrEqual(end);
    }
  });

  it("keeps showing today's frames for a tile the store has no frame for yet", () => {
    const { container } = renderStrip({}, { filmstripFiles: files });
    const srcs = stripImages(container).map((i) => i.getAttribute("src"));
    expect(srcs).toContain("opened-7.jpg");
    expect(decodedTiles(container)).toHaveLength(0);
  });
});
