import type { AppSettings } from "@shared/types/ipc";
import type { FrameMemory } from "./capture-overlay-windows";

/** The slice of the settings store the memory reads and writes; tests pass a fake. */
interface SettingsPort {
  get(): AppSettings;
  update(patch: Partial<AppSettings>): void;
}

/**
 * The capture frame's memory (NIW2-878), kept in the app settings: the display it was last
 * used on, apart for a screenshot and a recording, and the rectangle it had there (the same
 * `screenshotFrame` / `recordingArea` the overlay already reads when it opens, ADR 0030).
 *
 * Main owns the display and the close-time write. Settings are the store, not a new file, so
 * a restart keeps the selection and the overlay's own confirm-time write lands in the same
 * place. `save` takes every update of a close (each intent, each display) and makes one
 * `update` call (one persist, one broadcast), or none when nothing changed.
 */
export function createFrameMemory(settings: SettingsPort): FrameMemory {
  return {
    lastDisplay: (intent) => {
      if (intent === "instant") return null;
      return settings.get().lastFrameDisplay[intent] ?? null;
    },
    save: (updates) => {
      const current = settings.get();
      let { lastFrameDisplay, recordingArea, screenshotFrame } = current;
      for (const { intent, displayId, areas } of updates) {
        if (displayId !== null) lastFrameDisplay = { ...lastFrameDisplay, [intent]: displayId };
        for (const { displayId: areaDisplay, rect, ratio } of areas) {
          const key = String(areaDisplay);
          if (intent === "record") {
            recordingArea = { ...recordingArea, [key]: ratio ? { ...rect, ratio } : rect };
          } else {
            screenshotFrame = { ...screenshotFrame, [key]: rect };
          }
        }
      }
      const patch: Partial<AppSettings> = {};
      const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
      if (changed(lastFrameDisplay, current.lastFrameDisplay))
        patch.lastFrameDisplay = lastFrameDisplay;
      if (changed(recordingArea, current.recordingArea)) patch.recordingArea = recordingArea;
      if (changed(screenshotFrame, current.screenshotFrame))
        patch.screenshotFrame = screenshotFrame;
      if (Object.keys(patch).length > 0) settings.update(patch);
    },
  };
}
