import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPdfOffThread } from "./pdf-exporter";

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    createdWorkers.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

let createdWorkers: FakeWorker[] = [];

beforeEach(() => {
  createdWorkers = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => vi.unstubAllGlobals());

describe("buildPdfOffThread", () => {
  it("posts the png to the worker as a transferable and resolves with the transferred pdf", async () => {
    const png = new ArrayBuffer(8);
    const pending = buildPdfOffThread(png, 300, 150);
    const [worker] = createdWorkers;
    expect(worker!.postMessage).toHaveBeenCalledWith({ png, width: 300, height: 150 }, [png]);
    const pdf = new ArrayBuffer(4);
    worker!.emit({ type: "done", pdf });
    expect(await pending).toBe(pdf);
  });

  it("terminates the worker once it has answered", async () => {
    const pending = buildPdfOffThread(new ArrayBuffer(8), 1, 1);
    createdWorkers[0]!.emit({ type: "done", pdf: new ArrayBuffer(1) });
    await pending;
    expect(createdWorkers[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects with the worker's message and terminates on an error reply", async () => {
    const pending = buildPdfOffThread(new ArrayBuffer(8), 1, 1);
    createdWorkers[0]!.emit({ type: "error", message: "boom" });
    await expect(pending).rejects.toThrow("boom");
    expect(createdWorkers[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects and terminates when the worker itself errors", async () => {
    const pending = buildPdfOffThread(new ArrayBuffer(8), 1, 1);
    createdWorkers[0]!.onerror?.({ message: "load failed" } as ErrorEvent);
    await expect(pending).rejects.toThrow("load failed");
    expect(createdWorkers[0]!.terminate).toHaveBeenCalledTimes(1);
  });
});
