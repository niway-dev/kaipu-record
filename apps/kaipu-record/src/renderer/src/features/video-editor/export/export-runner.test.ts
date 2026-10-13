import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Translator } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { initialScene, type VideoScene } from "../scene";
import { createSlideAssetStore } from "../slide-assets";
import {
  __resetExportRunnerForTests,
  cancelVideoExport,
  dismissReadyExport,
  getExportSnapshot,
  isVideoExportBusy,
  retryVideoExport,
  startVideoExport,
  type StartExportArgs,
} from "./export-runner";

// The pipeline itself (plan, session lifecycle, FR8/FR9 retries) is covered through
// `useVideoExport` in use-video-export.test.ts. Here: what makes the runner app-level —
// one export at a time, the job the cards describe, the Ready card, Retry, and telling
// main an export is running.

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
let workers: FakeWorker[] = [];

const t = ((key: string, values?: Record<string, unknown>) =>
  values?.title !== undefined
    ? `${String(values.title)} (${key})`
    : key) as unknown as Translator<"videoEditor">;

const RECORDING: LocalRecording = {
  id: "new-rec",
  assetId: "asset-new",
  kind: "recording",
  title: "Demo (10 MB)",
  filePath: "/vault/new-rec.mp4",
  createdAt: 1,
  sizeBytes: 8_100_000,
  durationSeconds: 78,
  thumbnailUrl: null,
  derivedFromAssetId: "asset-src",
  contentSha256: null,
};

const SCENE: VideoScene = {
  ...initialScene(78),
  items: [{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 78 }],
  overlays: [],
};

function args(overrides: Partial<StartExportArgs> = {}): StartExportArgs {
  return {
    scene: SCENE,
    sourceId: "rec-1",
    title: "Demo",
    derivedFromAssetId: "asset-src",
    sourceSizeBytes: 119_000_000,
    videoWidth: 2560,
    videoHeight: 1440,
    previewWidth: 2560,
    slideAssets: createSlideAssetStore(),
    cameraPath: null,
    presetId: "small-10",
    onSaved: vi.fn(),
    ...overrides,
  };
}

const finish = (worker: FakeWorker): void =>
  worker.onmessage?.({ data: { type: "done" } } as MessageEvent);

beforeEach(() => {
  workers = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["mp4"]) })),
  );
  window.electronAPI.recordingCreate = vi.fn(async () => ({ tempPath: "/tmp/x.part" }));
  window.electronAPI.recordingWrite = vi.fn();
  window.electronAPI.recordingAbort = vi.fn(async () => {});
  window.electronAPI.recordingStat = vi.fn(async () => 8_100_000);
  window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
  window.electronAPI.setExportActive = vi.fn();
});

afterEach(() => {
  __resetExportRunnerForTests();
  vi.unstubAllGlobals();
});

describe("export runner (NIW2-218 background export)", () => {
  it("describes the job for the cards: preset, output size, estimate and the original's size", async () => {
    await startVideoExport(args(), t);
    const { status, job, attemptStartedAt } = getExportSnapshot();
    expect(status).toBe("exporting");
    expect(attemptStartedAt).not.toBeNull();
    expect(job).toMatchObject({
      presetId: "small-10",
      sourceTitle: "Demo",
      sourceAssetId: "asset-src",
      sourceSizeBytes: 119_000_000,
      capBytes: 10_000_000,
      width: 1280,
      height: 720,
    });
    expect(job!.estimateBytes).toBeGreaterThan(9_000_000);
    expect(job!.estimateBytes).toBeLessThanOrEqual(10_000_000);
  });

  it("runs one export at a time", async () => {
    expect(await startVideoExport(args(), t)).toBe(true);
    expect(isVideoExportBusy()).toBe(true);
    expect(await startVideoExport(args({ presetId: "youtube" }), t)).toBe(false);
    expect(workers).toHaveLength(1);
    expect(getExportSnapshot().job?.presetId).toBe("small-10");
  });

  it("tells main while an export runs, so closing or quitting asks first", async () => {
    await startVideoExport(args(), t);
    expect(window.electronAPI.setExportActive).toHaveBeenLastCalledWith(true);
    cancelVideoExport();
    expect(window.electronAPI.setExportActive).toHaveBeenLastCalledWith(false);
  });

  it("ends in a Ready card with the saved file, then calls onSaved", async () => {
    const onSaved = vi.fn();
    await startVideoExport(args({ onSaved }), t);
    finish(workers[0]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(RECORDING));
    const snapshot = getExportSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.ready).toMatchObject({ recording: RECORDING, job: { presetId: "small-10" } });
    expect(isVideoExportBusy()).toBe(false);

    dismissReadyExport();
    expect(getExportSnapshot().ready).toBeNull();
  });

  it("a failing onSaved (e.g. a session save) does not turn the finished export into an error", async () => {
    const onSaved = vi.fn(async () => {
      throw new Error("disk full");
    });
    await startVideoExport(args({ onSaved }), t);
    finish(workers[0]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await Promise.resolve();
    expect(getExportSnapshot().status).toBe("idle");
    expect(getExportSnapshot().ready).not.toBeNull();
  });

  it("a new export replaces the previous Ready card", async () => {
    await startVideoExport(args(), t);
    finish(workers[0]);
    await waitFor(() => expect(getExportSnapshot().ready).not.toBeNull());

    await startVideoExport(args({ presetId: "youtube" }), t);
    expect(getExportSnapshot().ready).toBeNull();
    finish(workers[1]);
    await waitFor(() => expect(getExportSnapshot().ready).not.toBeNull());
    await startVideoExport(args(), t);
    cancelVideoExport();
    expect(getExportSnapshot().ready).toBeNull();
  });

  it("Retry re-runs the export that failed", async () => {
    await startVideoExport(args(), t);
    workers[0].onmessage?.({ data: { type: "error", message: "boom" } } as MessageEvent);
    expect(getExportSnapshot()).toMatchObject({ status: "error", error: "exportGenericError" });
    // The failed job stays described, for the error card.
    expect(getExportSnapshot().job?.presetId).toBe("small-10");

    retryVideoExport();
    await waitFor(() => expect(workers).toHaveLength(2));
    expect(getExportSnapshot().status).toBe("exporting");
  });

  it("takes the slides at start, so the editor disposing its store can't break a running export", async () => {
    const store = createSlideAssetStore();
    const entries = vi.spyOn(store, "entries");
    await startVideoExport(args({ slideAssets: store }), t);
    expect(entries).toHaveBeenCalledOnce();
    store.dispose();
    // An FR8 retry (over the cap) launches again without asking the store.
    window.electronAPI.recordingStat = vi.fn(async () => 12_000_000);
    finish(workers[0]);
    await waitFor(() => expect(workers).toHaveLength(2));
    expect(getExportSnapshot().shrinking).toBe(true);
    expect(entries).toHaveBeenCalledOnce();
  });
});
