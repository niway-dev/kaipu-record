import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types/ipc";
import { createFrameMemory } from "./frame-memory";

function memoryOver(initial: Partial<AppSettings> = {}) {
  let settings = { ...DEFAULT_SETTINGS, ...initial } as AppSettings;
  const update = vi.fn((patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch } as AppSettings;
  });
  return {
    memory: createFrameMemory({ get: () => settings, update }),
    update,
    get: () => settings,
  };
}

const rect = { x: 10, y: 20, width: 300, height: 200 };

describe("createFrameMemory", () => {
  it("reads the last display of each intent from the settings", () => {
    const { memory } = memoryOver({ lastFrameDisplay: { capture: 3, record: 4 } });
    expect(memory.lastDisplay("capture")).toBe(3);
    expect(memory.lastDisplay("record")).toBe(4);
    expect(memory.lastDisplay("instant")).toBeNull();
  });

  it("knows no display before one was used", () => {
    expect(memoryOver().memory.lastDisplay("capture")).toBeNull();
  });

  it("saves the display and the rectangle of a screenshot frame in one settings write", () => {
    const { memory, update, get } = memoryOver({
      lastFrameDisplay: { record: 4 },
      screenshotFrame: { "7": { x: 1, y: 1, width: 50, height: 50 } },
    });

    memory.save([{ intent: "capture", displayId: 2, areas: [{ displayId: 2, rect }] }]);

    expect(update).toHaveBeenCalledOnce();
    expect(get().lastFrameDisplay).toEqual({ capture: 2, record: 4 });
    expect(get().screenshotFrame).toEqual({
      "7": { x: 1, y: 1, width: 50, height: 50 },
      "2": rect,
    });
    expect(get().recordingArea).toEqual({});
  });

  it("saves a recording area with its ratio, apart from the screenshot frame", () => {
    const { memory, get } = memoryOver();

    memory.save([
      { intent: "record", displayId: 1, areas: [{ displayId: 1, rect, ratio: "16:9" }] },
    ]);

    expect(get().recordingArea).toEqual({ "1": { ...rect, ratio: "16:9" } });
    expect(get().screenshotFrame).toEqual({});
    expect(get().lastFrameDisplay).toEqual({ record: 1 });
  });

  it("saves the display alone when the rectangle was not touched", () => {
    const { memory, update } = memoryOver({ screenshotFrame: { "1": rect } });

    memory.save([{ intent: "capture", displayId: 2, areas: [] }]);

    expect(update).toHaveBeenCalledWith({ lastFrameDisplay: { capture: 2 } });
  });

  it("saves the rectangle of another display than the one that holds the frame", () => {
    const { memory, get } = memoryOver();

    memory.save([{ intent: "capture", displayId: 2, areas: [{ displayId: 1, rect }] }]);

    expect(get().lastFrameDisplay).toEqual({ capture: 2 });
    expect(get().screenshotFrame).toEqual({ "1": rect });
  });

  it("writes nothing when the settings already say the same", () => {
    const { memory, update } = memoryOver({
      lastFrameDisplay: { capture: 2 },
      screenshotFrame: { "2": rect },
    });

    memory.save([{ intent: "capture", displayId: 2, areas: [{ displayId: 2, rect }] }]);

    expect(update).not.toHaveBeenCalled();
  });

  it("saves both intents and every display of a close in one settings write", () => {
    const { memory, update, get } = memoryOver();
    const other = { ...rect, width: 640 };

    memory.save([
      {
        intent: "capture",
        displayId: 2,
        areas: [
          { displayId: 1, rect },
          { displayId: 2, rect: other },
        ],
      },
      { intent: "record", displayId: 1, areas: [{ displayId: 1, rect, ratio: "16:9" }] },
    ]);

    expect(update).toHaveBeenCalledOnce();
    expect(get().lastFrameDisplay).toEqual({ capture: 2, record: 1 });
    expect(get().screenshotFrame).toEqual({ "1": rect, "2": other });
    expect(get().recordingArea).toEqual({ "1": { ...rect, ratio: "16:9" } });
  });
});
