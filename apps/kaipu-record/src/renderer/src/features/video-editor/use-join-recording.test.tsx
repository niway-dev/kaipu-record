import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { initialScene } from "./scene";
import { useJoinRecording, type JoinableRecording } from "./use-join-recording";
import { useVideoScene } from "./use-video-scene";

const composeSpy = vi.hoisted(() => vi.fn());
vi.mock("./compose-join", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compose-join")>();
  composeSpy.mockImplementation(actual.composeJoin);
  return { composeJoin: composeSpy };
});

const TRACK: CursorTrack = {
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 20_000],
  x: [0.5, 0.5],
  y: [0.5, 0.5],
  clicks: [{ t: 10_000, x: 0.5, y: 0.5, button: 0 }],
};
const B: JoinableRecording = {
  id: "b-file",
  assetId: "asset-b",
  title: "B",
  durationSeconds: 20,
  capture: { mode: "screen", width: 1920, height: 1080, ratio: null },
  webcam: null,
};

const original = { ...window.electronAPI };
let acquire: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  acquire = vi.fn(async () => "b-renamed");
  close = vi.fn();
  window.electronAPI.acquireEditorSession = acquire as never;
  window.electronAPI.closeEditorSession = close as never;
  window.electronAPI.loadCursorTrack = vi.fn(async () => JSON.stringify(TRACK)) as never;
});
afterEach(() => {
  Object.assign(window.electronAPI, original);
});

function setup() {
  return renderHook(() => {
    const controller = useVideoScene(initialScene(20));
    const join = useJoinRecording(controller, 20, 16 / 9);
    return { controller, join };
  });
}

describe("useJoinRecording", () => {
  it("joins in ONE undo step, with the recording's zooms, after reading its cursor track", async () => {
    const { result } = setup();
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.join(B, 20);
    });
    expect(outcome).toBe("joined");
    expect(window.electronAPI.loadCursorTrack).toHaveBeenCalledWith("b-renamed");
    const scene = result.current.controller.scene;
    expect(scene.sources).toEqual([
      expect.objectContaining({ assetId: "asset-b", offset: 3600, width: 1920, height: 1080 }),
    ]);
    expect(scene.items).toHaveLength(2);
    expect(scene.zoomSegments.length).toBeGreaterThan(0);

    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.sources).toBeUndefined();
    expect(result.current.controller.scene.items).toHaveLength(1);
    expect(result.current.controller.scene.zoomSegments).toEqual([]);
    expect(result.current.controller.canUndo).toBe(false);
  });

  it("releases the hold it took to resolve the id", async () => {
    const { result } = setup();
    await act(async () => void (await result.current.join(B, 20)));
    expect(close).toHaveBeenCalledWith("b-renamed");
  });

  it("is missing, and changes nothing, for a cloud-only recording or a refused hold", async () => {
    const { result } = setup();
    const before = result.current.controller.scene;
    let cloud: string | undefined;
    let refused: string | undefined;
    await act(async () => {
      cloud = await result.current.join({ ...B, id: null }, 20);
    });
    acquire.mockResolvedValueOnce(null);
    await act(async () => {
      refused = await result.current.join(B, 20);
    });
    expect([cloud, refused]).toEqual(["missing", "missing"]);
    expect(result.current.controller.scene).toBe(before);
    expect(result.current.controller.canUndo).toBe(false);
  });

  it("is missing when acquiring throws, and joins without zooms when the track cannot be read", async () => {
    const { result } = setup();
    acquire.mockRejectedValueOnce(new Error("ambiguous"));
    let first: string | undefined;
    await act(async () => {
      first = await result.current.join(B, 20);
    });
    expect(first).toBe("missing");

    window.electronAPI.loadCursorTrack = vi.fn(async () => {
      throw new Error("disk");
    }) as never;
    let second: string | undefined;
    await act(async () => {
      second = await result.current.join(B, 20);
    });
    expect(second).toBe("joined");
    expect(result.current.controller.scene.zoomSegments).toEqual([]);
    expect(result.current.controller.scene.sources).toHaveLength(1);
  });

  it("does not join while a drag owns the scene", async () => {
    const { result } = setup();
    act(() => result.current.controller.beginInteract());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.join(B, 20);
    });
    expect(outcome).toBe("busy");
    expect(result.current.controller.scene.sources).toBeUndefined();
  });

  it("keeps both joins when a second one is called before the first has rendered", async () => {
    const C: JoinableRecording = { ...B, id: "c-file", assetId: "asset-c", title: "C" };
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    acquire.mockImplementation(async (assetId: string) => {
      await gate;
      return `${assetId}-held`;
    });
    const { result } = setup();

    // Called outside act so React renders between tasks as it does in the app. Both IPC answers
    // arrive in the same tick: without a guard the second join resumes before the first rendered.
    const first = result.current.join(B, 20);
    const second = result.current.join(C, 20);
    openGate();
    const outcomes = await Promise.all([first, second]);

    expect(outcomes).toEqual(["joined", "joined"]);
    await waitFor(() =>
      expect(result.current.controller.scene.sources?.map((source) => source.assetId)).toEqual([
        "asset-b",
        "asset-c",
      ]),
    );
    expect(result.current.controller.scene.items).toHaveLength(3);

    // Each join is its own undo step, and undoing both lands on the scene before the first.
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.sources).toHaveLength(1);
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.sources).toBeUndefined();
    expect(result.current.controller.canUndo).toBe(false);
  });

  describe("the track the join-time zooms are detected on", () => {
    const dwellAt = (x: number): CursorTrack => ({
      ...TRACK,
      x: [x, x],
      clicks: [{ t: 10_000, x, y: 0.5, button: 0 }],
    });
    const trackGivenToCompose = async (b: JoinableRecording, frameAspect: number) => {
      window.electronAPI.loadCursorTrack = vi.fn(async () => JSON.stringify(dwellAt(0.1))) as never;
      composeSpy.mockClear();
      const { result } = renderHook(() => {
        const controller = useVideoScene(initialScene(20));
        return { controller, join: useJoinRecording(controller, 20, frameAspect) };
      });
      await act(async () => void (await result.current.join(b, 20)));
      return composeSpy.mock.calls[0][4];
    };

    it("is in frame coordinates when the recording's aspect differs from the frame's", async () => {
      const square = {
        ...B,
        capture: { mode: "screen" as const, width: 1000, height: 1000, ratio: null },
      };
      const track = await trackGivenToCompose(square, 16 / 9);
      // illustrative: a 1:1 picture centred in a 16:9 frame, x = 0.5 + (0.1 - 0.5) * (9 / 16)
      expect(track?.x[0]).toBeCloseTo(0.275, 3);
      expect(track?.clicks[0].x).toBeCloseTo(0.275, 3);
    });

    it("stays unchanged when the aspects match", async () => {
      const track = await trackGivenToCompose(B, 16 / 9);
      expect(track?.x[0]).toBeCloseTo(0.1, 6);
    });
  });
});
