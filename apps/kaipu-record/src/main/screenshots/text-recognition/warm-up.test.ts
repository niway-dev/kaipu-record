import { describe, expect, it, vi } from "vitest";
import type { RecognizedWord, TextRecognizer } from "@kaipu/domain/schemas";
import { TextRecognitionWarmUp, withWarmUpGate, type WarmUpDeps } from "./warm-up";
import { warmUpPng } from "./warm-up-image";

const WORDS: RecognizedWord[] = [];

function setup(overrides: Partial<WarmUpDeps> = {}) {
  let present = true;
  const recognize = vi.fn(async (): Promise<RecognizedWord[] | "unavailable"> => WORDS);
  const recognizer: TextRecognizer = { recognize };
  const idle: Array<() => void> = [];
  const deps: WarmUpDeps = {
    recognizer,
    platform: "darwin",
    helperPresent: async () => present,
    devOverrideActive: false,
    scheduleIdle: (run) => void idle.push(run),
    ...overrides,
  };
  const warmUp = new TextRecognitionWarmUp(deps);
  return {
    warmUp,
    recognize,
    recognizer,
    setPresent: (value: boolean) => (present = value),
    fireIdle: () => idle.splice(0).forEach((run) => run()),
  };
}

describe("TextRecognitionWarmUp", () => {
  it("waits for the idle delay and for the flag before it recognizes anything", async () => {
    const t = setup();
    t.warmUp.start();
    t.warmUp.setEnabled(true);
    await t.warmUp.whenSettled();
    expect(t.recognize).not.toHaveBeenCalled();
    t.fireIdle();
    await t.warmUp.whenSettled();
    expect(t.recognize).toHaveBeenCalledTimes(1);
    expect(t.recognize).toHaveBeenCalledWith(warmUpPng());
  });

  it("runs once the flag arrives after the idle delay, and only once", async () => {
    const t = setup();
    t.warmUp.start();
    t.fireIdle();
    await t.warmUp.whenSettled();
    expect(t.recognize).not.toHaveBeenCalled();
    t.warmUp.setEnabled(true);
    t.warmUp.setEnabled(true);
    await t.warmUp.whenSettled();
    expect(t.recognize).toHaveBeenCalledTimes(1);
  });

  it("warms again on every launch: there is no stamp to skip it", async () => {
    for (let launch = 0; launch < 2; launch++) {
      const t = setup();
      t.warmUp.start();
      t.warmUp.setEnabled(true);
      t.fireIdle();
      await t.warmUp.whenSettled();
      expect(t.recognize).toHaveBeenCalledTimes(1);
    }
  });

  it("never throws when the recognition is unavailable or fails", async () => {
    for (const recognize of [
      vi.fn(async () => "unavailable" as const),
      vi.fn(async (): Promise<never> => {
        throw new Error("boom");
      }),
    ]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const t = setup({ recognizer: { recognize } });
      t.warmUp.start();
      t.warmUp.setEnabled(true);
      t.fireIdle();
      await expect(t.warmUp.whenSettled()).resolves.toBeUndefined();
      expect(recognize).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    }
  });

  it("stays off when the KAIPU_TEXT_RECOGNITION dev override is active", async () => {
    const t = setup({ devOverrideActive: true });
    t.warmUp.start();
    t.warmUp.setEnabled(true);
    t.fireIdle();
    await t.warmUp.whenSettled();
    expect(t.recognize).not.toHaveBeenCalled();
  });

  it("an Admin-forced `image-text` flag does not warm anything up off macOS (ADR 0067)", async () => {
    // Admin mode makes the renderer report `image-text` as on; the platform check is separate.
    for (const platform of ["win32", "linux"] as const) {
      const t = setup({ platform });
      t.warmUp.start();
      t.warmUp.setEnabled(true);
      t.fireIdle();
      await t.warmUp.whenSettled();
      expect(t.recognize).not.toHaveBeenCalled();
    }
  });

  it("does nothing off macOS, with the flag off, or when the helper is missing", async () => {
    const win = setup({ platform: "win32" });
    win.warmUp.start();
    win.warmUp.setEnabled(true);
    win.fireIdle();
    await win.warmUp.whenSettled();
    expect(win.recognize).not.toHaveBeenCalled();

    const off = setup();
    off.warmUp.start();
    off.warmUp.setEnabled(false);
    off.fireIdle();
    await off.warmUp.whenSettled();
    expect(off.recognize).not.toHaveBeenCalled();

    const missing = setup();
    missing.setPresent(false);
    missing.warmUp.start();
    missing.warmUp.setEnabled(true);
    missing.fireIdle();
    await missing.warmUp.whenSettled();
    expect(missing.recognize).not.toHaveBeenCalled();
  });
});

describe("withWarmUpGate", () => {
  it("holds an editor recognition until the running warm-up ends, then runs it once", async () => {
    let release: () => void = () => {};
    const recognize = vi.fn(async (png: Uint8Array): Promise<RecognizedWord[] | "unavailable"> => {
      if (png.byteLength === warmUpPng().byteLength) await new Promise<void>((r) => (release = r));
      return WORDS;
    });
    const t = setup({ recognizer: { recognize } });
    t.warmUp.start();
    t.warmUp.setEnabled(true);
    t.fireIdle();
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));

    const gated = withWarmUpGate({ recognize }, t.warmUp);
    const editorPng = new Uint8Array([1, 2, 3]);
    const editor = gated.recognize(editorPng);
    await new Promise((r) => setTimeout(r, 10));
    expect(recognize).toHaveBeenCalledTimes(1); // no second parallel cold helper

    release();
    await editor;
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(recognize).toHaveBeenLastCalledWith(editorPng);
  });

  it("skips a warm-up that has not started when an editor recognition got there first", async () => {
    const t = setup();
    t.warmUp.start();
    t.fireIdle();
    await withWarmUpGate(t.recognizer, t.warmUp).recognize(new Uint8Array([9]));
    t.warmUp.setEnabled(true);
    await t.warmUp.whenSettled();
    expect(t.recognize).toHaveBeenCalledTimes(1); // the editor's, not a warm-up
  });

  it("passes straight through when no warm-up is running", async () => {
    const t = setup();
    const gated = withWarmUpGate(t.recognizer, t.warmUp);
    await gated.recognize(new Uint8Array([9]));
    expect(t.recognize).toHaveBeenCalledTimes(1);
  });
});
