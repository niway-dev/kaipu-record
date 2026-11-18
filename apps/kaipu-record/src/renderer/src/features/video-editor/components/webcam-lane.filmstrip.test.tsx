import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetFilmstripStoreForTests, getFilmstripStore } from "../filmstrip-service";
import { PUBLISH_MS } from "../filmstrip-store";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import { WebcamLane } from "./webcam-lane";

const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
];
const layout = toLayout(items);

const WEBCAM_KEY = "kaipu-media://webcam/opened";
// The camera started 2 s after the screen (ADR 0037): its own time is source time - 2.
const COMPANION_OFFSET = 2;
const legacy = [{ sourceTime: 3, url: "legacy-3.jpg" }];

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
  URL.createObjectURL = vi.fn(() => `blob:webcam-${urls++}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  __resetFilmstripStoreForTests();
  vi.unstubAllGlobals();
});

function renderLane(filmstripFiles?: React.ComponentProps<typeof WebcamLane>["filmstripFiles"]) {
  return render(
    <WebcamLane
      layout={layout}
      segments={[]}
      thumbnails={legacy}
      covered={{ start: COMPANION_OFFSET, end: 30 }}
      filmstripFiles={filmstripFiles}
      selectedId={null}
      onSelect={vi.fn()}
      onEdgeDrag={vi.fn()}
    />,
  );
}

async function storeFrames(from: number, to: number): Promise<void> {
  await act(async () => {
    for (let t = from; t <= to; t += 0.5) {
      getFilmstripStore().add(WEBCAM_KEY, { timestamp: t, blob: new Blob(["x"]), bytes: 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, PUBLISH_MS + 50));
  });
}

const decoded = (root: ParentNode): HTMLImageElement[] =>
  [...root.querySelectorAll<HTMLImageElement>("img[data-filmstrip-frame]")].filter((img) =>
    (img.getAttribute("src") ?? "").startsWith("blob:"),
  );

describe("WebcamLane filmstrip (NIW2-844, flag zoom-filmstrip)", () => {
  it("AC11: without filmstripFiles it draws today's frames and no filmstrip attribute", async () => {
    const { container } = renderLane();
    await storeFrames(0, 20);
    expect(container.querySelector("[data-filmstrip-frame]")).toBeNull();
    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((src) => src === "legacy-3.jpg")).toBe(true);
  });

  it("reads the camera at its own time: source time minus the companion offset", async () => {
    const { container } = renderLane(
      new Map([[null, { fileKey: WEBCAM_KEY, companionOffset: COMPANION_OFFSET }]]),
    );
    await storeFrames(0, 20);
    const strips = container.querySelectorAll("[data-webcam-filmstrip] > div");
    expect(strips).toHaveLength(2);
    const first = decoded(strips[0]);
    const second = decoded(strips[1]);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    const spanEnd = (img: HTMLImageElement): number =>
      Number((img.getAttribute("data-filmstrip-span") ?? "").split(",")[1]);
    const spanStart = (img: HTMLImageElement): number =>
      Number((img.getAttribute("data-filmstrip-span") ?? "").split(",")[0]);
    // Clip a is source [0, 5]: camera time [-2, 3]. Clip b is source [10, 20]: camera [8, 18].
    for (const img of first) expect(spanEnd(img)).toBeLessThanOrEqual(3 + 1e-6);
    for (const img of second) {
      expect(spanStart(img)).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(spanEnd(img)).toBeLessThanOrEqual(18 + 1e-6);
    }
  });
});

it("mounts worker-backed webcam tiles without any legacy strip", async () => {
  const props = {
    layout,
    segments: [],
    thumbnails: [],
    recordingStrips: new Map(),
    selectedId: null,
    onSelect: vi.fn(),
    onEdgeDrag: vi.fn(),
  };
  const { container, rerender } = render(
    <WebcamLane
      {...props}
      filmstripFiles={new Map([[null, { fileKey: WEBCAM_KEY, companionOffset: COMPANION_OFFSET }]])}
    />,
  );
  await storeFrames(0, 20);
  expect(decoded(container).length).toBeGreaterThan(0);
  rerender(<WebcamLane {...props} />);
  expect(container.querySelector("[data-webcam-filmstrip]")).toBeNull();
});
