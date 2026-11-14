import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenshotAfterCapture, ScreenshotCopyMode } from "@shared/types";
import type { CaptureAction } from "@shared/types/screenshot-capture";
import { createCaptureHandler } from "./capture-handler";
import {
  clearLastQuietCapture,
  keepLastQuietCapture,
  takeLastQuietCapture,
} from "./last-quiet-capture";
import type { OverlayPort } from "./overlay-port";
import {
  MacProvider,
  type ProviderResult,
  type ScreenshotCaptureProvider,
} from "./screenshot-capture";

const overlay: OverlayPort = {
  pick: async () => ({ kind: "cancelled" }),
  hideAll: async () => {},
  destroyAll: () => {},
};

// Copying manual by default, so a Capture touches the clipboard only when a test asks.
let prefs: { copy: ScreenshotCopyMode; afterCapture?: ScreenshotAfterCapture } = { copy: "manual" };
let takeNow = false;
beforeEach(() => {
  takeNow = false;
  prefs = { copy: "manual" };
  clearLastQuietCapture();
});

function setup(
  capture: ScreenshotCaptureProvider["capture"],
  platform: NodeJS.Platform = "darwin",
  supports: (mode: string) => boolean = () => true,
) {
  const windows = { beforeCapture: vi.fn(), afterCapture: vi.fn(), reveal: vi.fn() };
  const track = vi.fn();
  const rememberMode = vi.fn();
  const saveToVault = vi.fn(async (_png: Buffer, _title: string, _workspaceId?: string) => ({
    id: "screenshot-1",
    assetId: "asset-1",
  }));
  const workspace = vi.fn(() => ({ id: "ws-work", name: "Work" }));
  const copyToClipboard = vi.fn();
  const onQuietCapture = vi.fn();
  const onRecordTarget = vi.fn();
  const recordingTarget = vi.fn(async () => ({ displayId: 2, rect: null }));
  const handler = createCaptureHandler({
    platform,
    provider: { capture, supports, supportedModes: () => [] },
    overlay,
    windows,
    measure: () => ({ width: 3, height: 2 }),
    displayCount: () => 2,
    track,
    rememberMode,
    settings: () => prefs,
    saveToVault,
    copyToClipboard,
    thumbnail: () => "data:image/png;base64,thumb",
    onQuietCapture,
    onRecordTarget,
    workspace,
    duringTake: () => takeNow,
    recordingTarget,
  });
  return {
    handler,
    recordingTarget,
    windows,
    track,
    rememberMode,
    saveToVault,
    copyToClipboard,
    onQuietCapture,
    onRecordTarget,
    workspace,
  };
}

describe("createCaptureHandler — choosing what to record", () => {
  const rect = { x: 100, y: 50, width: 640, height: 360 };

  it("opens the overlay with the request's intent", async () => {
    const capture = vi.fn(async (): Promise<ProviderResult> => ({ kind: "cancelled" }));
    const { handler } = setup(capture);
    await handler({ mode: "frame", intent: "record" });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "frame", intent: "record" }),
    );
  });

  it("an instant capture is saved but never becomes the current mode", async () => {
    const capture = vi.fn(
      async (): Promise<ProviderResult> => ({
        kind: "captured",
        png: Buffer.from([1]),
        mode: "screen",
        action: "capture",
      }),
    );
    const { handler, rememberMode, saveToVault } = setup(capture);
    const result = await handler({ mode: "screen", intent: "instant" });
    expect(result.kind).toBe("captured");
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ intent: "instant" }));
    expect(saveToVault).toHaveBeenCalledOnce();
    expect(rememberMode).not.toHaveBeenCalled();
  });

  it("hands countdownDone to onRecordTarget when the overlay already counted down", async () => {
    const { handler, onRecordTarget } = setup(async () => ({
      kind: "record",
      start: true,
      displayId: 2,
      rect,
      countdownDone: true,
    }));
    await handler({ mode: "frame" });
    expect(onRecordTarget).toHaveBeenCalledExactlyOnceWith({
      displayId: 2,
      rect,
      start: true,
      countdownDone: true,
    });
  });

  it("hands a record answer to main and takes no screenshot", async () => {
    const { handler, onRecordTarget, saveToVault, track, rememberMode, windows } = setup(
      async () => ({ kind: "record", start: true, displayId: 2, rect }),
    );
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(onRecordTarget).toHaveBeenCalledExactlyOnceWith({ displayId: 2, rect, start: true });
    expect(saveToVault).not.toHaveBeenCalled();
    expect(rememberMode).not.toHaveBeenCalled();
    // Not a screenshot: nothing goes into screenshot_captured.
    expect(track).not.toHaveBeenCalled();
    // The countdown runs on the chosen region: the main window stays out of sight.
    expect(windows.afterCapture).toHaveBeenCalledWith("recording");
  });

  it("a Record answer main could not take restores the windows as a cancel", async () => {
    const { handler, onRecordTarget, windows } = setup(async () => ({
      kind: "record",
      start: true,
      displayId: 2,
      rect,
    }));
    onRecordTarget.mockImplementation(() => {
      throw new Error("hub gone");
    });
    await handler({ mode: "frame", intent: "record" });
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
  });

  it("a recording request that throws still restores the windows", async () => {
    const { handler, onRecordTarget, windows } = setup(async () => ({
      kind: "record",
      start: false,
      displayId: 2,
      rect: null,
    }));
    onRecordTarget.mockImplementation(() => {
      throw new Error("hub gone");
    });
    expect(await handler({ mode: "screen" })).toEqual({ kind: "cancelled" });
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
  });

  it("refuses an unknown intent", async () => {
    const capture = vi.fn();
    const { handler } = setup(capture);
    await expect(handler({ mode: "frame", intent: "film" })).rejects.toThrow(/intent/);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("createCaptureHandler", () => {
  it("makes the mode the overlay captured with the current one, only on a captured result", async () => {
    // The user opened Frame and switched to Screen on the overlay before capturing.
    const { handler, rememberMode } = setup(async () => ({
      kind: "captured",
      png: Buffer.from([1]),
      mode: "screen",
      action: "copy",
    }));
    await handler({ mode: "frame" });
    expect(rememberMode).toHaveBeenCalledExactlyOnceWith("screen");
  });

  it("leaves the current mode untouched after a cancelled pick (Esc)", async () => {
    const { handler, rememberMode } = setup(async () => ({ kind: "cancelled" }));
    await handler({ mode: "window" });
    expect(rememberMode).not.toHaveBeenCalled();
  });

  it("answers unsupported for a window request when Window is disabled", async () => {
    const capture = vi.fn();
    const { handler } = setup(capture, "darwin", (mode) =>
      new MacProvider().supports(mode as never),
    );
    expect(await handler({ mode: "window" })).toMatchObject({
      kind: "unsupported",
      mode: "window",
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it("leaves the current mode untouched when the capture is unsupported or throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unsupported = setup(async () => ({ kind: "unsupported", mode: "window" }));
    await unsupported.handler({ mode: "frame" });
    expect(unsupported.rememberMode).not.toHaveBeenCalled();
    // Nothing opened: the window comes back as after a cancel.
    expect(unsupported.windows.afterCapture).toHaveBeenCalledWith("cancelled");

    const thrown = setup(vi.fn().mockRejectedValueOnce(new Error("boom")));
    await thrown.handler({ mode: "frame" });
    expect(thrown.rememberMode).not.toHaveBeenCalled();
  });

  it("still answers the capture when remembering the mode fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, rememberMode } = setup(async () => ({
      kind: "captured",
      png: Buffer.from([1]),
      mode: "frame",
      action: "capture",
    }));
    rememberMode.mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(await handler({ mode: "frame" })).toMatchObject({ kind: "captured", mode: "frame" });
  });

  it("answers captured with the saved item, size and mode", async () => {
    const { handler, windows } = setup(async ({ mode }) => ({
      kind: "captured",
      png: Buffer.from([1, 2, 3]),
      mode,
      action: "capture",
    }));
    const out = await handler({ mode: "frame" });
    expect(out).toMatchObject({
      kind: "captured",
      after: "quiet",
      saved: { id: "screenshot-1", assetId: "asset-1" },
      copied: false,
      width: 3,
      height: 2,
      mode: "frame",
    });
    expect(windows.afterCapture).toHaveBeenCalledWith("quiet");
  });

  it("answers cancelled and restores the window", async () => {
    const { handler, windows } = setup(async () => ({ kind: "cancelled" }));
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
  });

  it("answers unsupported with the platform it ran on", async () => {
    const capture = vi.fn();
    const { handler, windows } = setup(capture, "win32", () => false);
    expect(await handler({ mode: "screen" })).toEqual({
      kind: "unsupported",
      mode: "screen",
      platform: "win32",
    });
    // The app window must not flicker for an answer that needs no capture.
    expect(windows.beforeCapture).not.toHaveBeenCalled();
    expect(windows.afterCapture).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("reports one event per answered request with only mode, platform, displays and outcome", async () => {
    const captured = setup(async ({ mode }) => ({
      kind: "captured",
      png: Buffer.from([1]),
      mode,
      action: "capture",
    }));
    await captured.handler({ mode: "screen" });
    expect(captured.track).toHaveBeenCalledOnce();
    expect(captured.track).toHaveBeenCalledWith({
      mode: "screen",
      platform: "darwin",
      displays: 2,
      outcome: "captured",
      after: "quiet",
    });

    const cancelled = setup(async () => ({ kind: "cancelled" }));
    await cancelled.handler({ mode: "frame" });
    expect(cancelled.track).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "frame", outcome: "cancelled" }),
    );

    const unsupported = setup(vi.fn(), "win32", () => false);
    await unsupported.handler({ mode: "frame" });
    expect(unsupported.track).toHaveBeenCalledWith({
      mode: "frame",
      platform: "win32",
      displays: 2,
      outcome: "unsupported",
    });
  });

  it("does not report the re-entrant request it turns away, nor an invalid mode", async () => {
    let finish!: (r: ProviderResult) => void;
    const { handler, track } = setup(() => new Promise<ProviderResult>((r) => (finish = r)));
    const first = handler({ mode: "frame" });
    await handler({ mode: "frame" });
    expect(track).not.toHaveBeenCalled();
    finish({ kind: "cancelled" });
    await first;
    expect(track).toHaveBeenCalledOnce();
    await expect(handler({ mode: "area" })).rejects.toThrow();
    expect(track).toHaveBeenCalledOnce();
  });

  it("still answers when analytics throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, track } = setup(async () => ({ kind: "cancelled" }));
    track.mockImplementation(() => {
      throw new Error("posthog down");
    });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(logged).toHaveBeenCalled();
  });

  it("rejects an unknown mode before touching the windows", async () => {
    const capture = vi.fn();
    const { handler, windows } = setup(capture);
    await expect(handler({ mode: "area" })).rejects.toThrow(/unknown mode/);
    await expect(handler(undefined)).rejects.toThrow(/unknown mode/);
    expect(windows.beforeCapture).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("answers cancelled to a second request while one is in flight, leaving the first alone", async () => {
    let finish!: (r: ProviderResult) => void;
    const capture = vi.fn(() => new Promise<ProviderResult>((resolve) => (finish = resolve)));
    const { handler, windows } = setup(capture);

    const first = handler({ mode: "frame" });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(windows.beforeCapture).toHaveBeenCalledTimes(1);
    expect(windows.afterCapture).not.toHaveBeenCalled();

    finish({ kind: "cancelled" });
    await first;
    expect(windows.afterCapture).toHaveBeenCalledTimes(1);

    // The guard is released afterwards.
    finish = () => {};
    void handler({ mode: "frame" });
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("releases the guard and restores the window when hiding the windows throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = vi.fn().mockResolvedValue({ kind: "cancelled" });
    const { handler, windows } = setup(capture);
    windows.beforeCapture.mockImplementationOnce(() => {
      throw new Error("hide failed");
    });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(logged).toHaveBeenCalled();
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
    expect(capture).not.toHaveBeenCalled();
    // The next request is not turned away by a stuck guard.
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("answers cancelled, logs, releases the guard and restores the window when the provider throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const { handler, windows } = setup(capture);
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(logged).toHaveBeenCalled();
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
    capture.mockResolvedValueOnce({ kind: "cancelled" });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
  });

  it("reports a provider throw as failed, not cancelled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, track } = setup(vi.fn().mockRejectedValueOnce(new Error("boom")));
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(track).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith({
      mode: "frame",
      platform: "darwin",
      displays: 2,
      outcome: "failed",
    });
  });

  describe("after capture", () => {
    const shot = (action: CaptureAction) =>
      vi.fn(async ({ mode }: { mode: "frame" | "window" | "screen" }) => ({
        kind: "captured" as const,
        png: Buffer.from([9, 8, 7]),
        mode,
        action,
      }));

    it("Capture saves one vault item and finishes quietly in the preview card (ADR 0042)", async () => {
      const { handler, saveToVault, copyToClipboard, windows, onQuietCapture } = setup(
        shot("capture"),
      );
      const out = await handler({ mode: "frame" });
      expect(saveToVault).toHaveBeenCalledOnce();
      expect(saveToVault.mock.calls[0]![0]).toEqual(Buffer.from([9, 8, 7]));
      expect(saveToVault.mock.calls[0]![1]).toMatch(/^Kaipu Screenshot \d{4}-\d{2}-\d{2} at /);
      expect(copyToClipboard).not.toHaveBeenCalled();
      expect(out).toMatchObject({
        kind: "captured",
        after: "quiet",
        saved: { id: "screenshot-1", assetId: "asset-1" },
        copied: false,
        width: 3,
        height: 2,
        mode: "frame",
      });
      if (out.kind !== "captured") throw new Error("unreachable");
      expect(out.png.byteLength).toBe(0);
      // The app stays where it was; only the card appears.
      expect(windows.afterCapture).toHaveBeenCalledWith("quiet");
      expect(onQuietCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          saved: { id: "screenshot-1", assetId: "asset-1" },
          copied: false,
        }),
      );
      // Saved, so the card opens the vault item: no bytes are kept.
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("configured Capture opens only the saved editor, without a card", async () => {
      prefs = { copy: "auto", afterCapture: "editor" };
      const { handler, onQuietCapture, windows, copyToClipboard } = setup(shot("capture"));
      expect(await handler({ mode: "frame" })).toMatchObject({ after: "editor", copied: true });
      expect(onQuietCapture).not.toHaveBeenCalled();
      expect(copyToClipboard).toHaveBeenCalledOnce();
      expect(windows.afterCapture).toHaveBeenCalledWith("editor");
    });

    it("Copy ignores the editor preference and only confirms a successful copy", async () => {
      prefs = { copy: "manual", afterCapture: "editor" };
      const { handler, onQuietCapture } = setup(shot("copy"));
      expect(await handler({ mode: "frame" })).toMatchObject({ after: "quiet", copied: true });
      expect(onQuietCapture).toHaveBeenCalledWith(
        expect.objectContaining({ presentation: "copied" }),
      );
    });

    it("uses the Capture destination from the start, even if preferences change in the overlay", async () => {
      prefs = { copy: "manual", afterCapture: "editor" };
      const capture = shot("capture");
      const { handler } = setup(async (request) => {
        prefs = { copy: "manual", afterCapture: "preview" };
        return capture(request);
      });
      expect(await handler({ mode: "frame" })).toMatchObject({ after: "editor" });
    });

    it("a failed explicit Copy shows recovery actions instead of claiming success", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { handler, copyToClipboard, onQuietCapture } = setup(shot("copy"));
      copyToClipboard.mockImplementationOnce(() => {
        throw new Error("clipboard unavailable");
      });
      expect(await handler({ mode: "frame" })).toMatchObject({ after: "quiet", copied: false });
      expect(onQuietCapture.mock.calls[0]?.[0]).not.toHaveProperty("presentation");
    });

    it("Capture also copies when copying is automatic", async () => {
      prefs = { copy: "auto" };
      const { handler, copyToClipboard } = setup(shot("capture"));
      const out = await handler({ mode: "screen" });
      expect(copyToClipboard).toHaveBeenCalledWith(Buffer.from([9, 8, 7]));
      expect(out).toMatchObject({ after: "quiet", copied: true });
    });

    it("Capture whose save fails but copied shows the card and keeps the bytes for Save", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      prefs = { copy: "auto" };
      const { handler, saveToVault, copyToClipboard, windows, onQuietCapture } = setup(
        shot("capture"),
      );
      saveToVault.mockRejectedValueOnce(new Error("disk full"));
      const out = await handler({ mode: "frame" });
      expect(out).toMatchObject({ after: "quiet", saved: null, copied: true });
      expect(copyToClipboard).toHaveBeenCalledOnce();
      expect(windows.afterCapture).toHaveBeenCalledWith("quiet");
      expect(onQuietCapture).toHaveBeenCalledWith(
        expect.objectContaining({ saved: null, copied: true }),
      );
      expect(takeLastQuietCapture()?.png).toEqual(Buffer.from([9, 8, 7]));
    });

    it("Capture that landed nowhere opens the bytes in memory and copies nothing", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      prefs = { copy: "manual" };
      const { handler, saveToVault, copyToClipboard, windows, onQuietCapture } = setup(
        shot("capture"),
      );
      saveToVault.mockRejectedValueOnce(new Error("disk full"));
      const out = await handler({ mode: "frame" });
      if (out.kind !== "captured") throw new Error("unreachable");
      expect(out).toMatchObject({ after: "editor", saved: null, copied: false });
      expect(new Uint8Array(out.png)).toEqual(new Uint8Array([9, 8, 7]));
      // The in-memory editor runs its own auto copy; main must not copy twice.
      expect(copyToClipboard).not.toHaveBeenCalled();
      expect(windows.afterCapture).toHaveBeenCalledWith("editor");
      expect(onQuietCapture).not.toHaveBeenCalled();
    });

    it("Copy saves, copies and finishes quietly, whatever the copy preference", async () => {
      const { handler, saveToVault, copyToClipboard, windows } = setup(shot("copy"));
      const out = await handler({ mode: "window" });
      expect(saveToVault).toHaveBeenCalledOnce();
      expect(copyToClipboard).toHaveBeenCalledOnce();
      // Quiet: the window comes back without taking the focus from the app.
      expect(windows.afterCapture).toHaveBeenCalledExactlyOnceWith("quiet");
      expect(out).toMatchObject({
        after: "quiet",
        saved: { id: "screenshot-1", assetId: "asset-1" },
        copied: true,
        mode: "window",
      });
      if (out.kind !== "captured") throw new Error("unreachable");
      expect(out.png.byteLength).toBe(0);
      // A saved shot is edited from the vault, so nothing is kept in memory.
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("hands the toast hook an image confirmation per successful Copy", async () => {
      const { handler, onQuietCapture } = setup(shot("copy"));
      await handler({ mode: "frame" });
      expect(onQuietCapture).toHaveBeenCalledExactlyOnceWith({
        presentation: "copied",
        thumbnail: "data:image/png;base64,thumb",
        width: 3,
        height: 2,
        mode: "frame",
        saved: { id: "screenshot-1", assetId: "asset-1" },
        copied: true,
        workspace: { id: "ws-work", name: "Work" },
        policy: { workspaceId: "ws-work", screenshotCopy: "manual" },
      });
    });

    it("binds the capture to the workspace active when it started (the save, the bytes, the toast)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { handler, saveToVault, onQuietCapture, workspace } = setup(shot("copy"));
      saveToVault.mockRejectedValueOnce(new Error("Work isn't connected"));
      await handler({ mode: "frame" });
      expect(workspace).toHaveBeenCalledOnce();
      expect(saveToVault.mock.calls[0]![2]).toBe("ws-work");
      expect(onQuietCapture).toHaveBeenCalledWith(
        expect.objectContaining({ workspace: { id: "ws-work", name: "Work" } }),
      );
      expect(takeLastQuietCapture()?.workspaceId).toBe("ws-work");
    });

    describe("the capture keeps the settings it started with (ADR 0034, decision 4)", () => {
      it("reads the workspace and the copy mode once, at the start, and answers with them", async () => {
        prefs = { copy: "auto" };
        const { handler } = setup(shot("capture"));
        const out = await handler({ mode: "frame" });
        expect(out).toMatchObject({
          kind: "captured",
          policy: { workspaceId: "ws-work", screenshotCopy: "auto" },
        });
      });

      it("a switch and a Settings edit while the overlay is open change nothing about this capture", async () => {
        prefs = { copy: "auto" };
        let activeNow = { id: "ws-work", name: "Work" };
        const workspace = vi.fn(() => activeNow);
        const saveToVault = vi.fn(async (_png: Buffer, _title: string, _workspaceId?: string) => ({
          id: "s",
          assetId: "a",
        }));
        const copyToClipboard = vi.fn();
        const onQuietCapture = vi.fn();
        const handler = createCaptureHandler({
          platform: "darwin",
          // The user picks the area; meanwhile the app switches to Personal, where the copy
          // mode is "manual", and the user flips the setting too.
          provider: {
            capture: async ({ mode }) => {
              activeNow = { id: "ws-personal", name: "Personal" };
              prefs = { copy: "manual" };
              return { kind: "captured", png: Buffer.from([1]), mode, action: "copy" };
            },
            supports: () => true,
            supportedModes: () => [],
          },
          overlay,
          windows: { beforeCapture: vi.fn(), afterCapture: vi.fn(), reveal: vi.fn() },
          measure: () => ({ width: 3, height: 2 }),
          displayCount: () => 1,
          track: vi.fn(),
          rememberMode: vi.fn(),
          settings: () => prefs,
          saveToVault,
          copyToClipboard,
          thumbnail: () => "t",
          onQuietCapture,
          workspace,
        });
        const out = await handler({ mode: "frame" });
        expect(saveToVault.mock.calls[0]![2]).toBe("ws-work");
        expect(onQuietCapture).toHaveBeenCalledWith(
          expect.objectContaining({
            workspace: { id: "ws-work", name: "Work" },
            policy: { workspaceId: "ws-work", screenshotCopy: "auto" },
          }),
        );
        expect(out).toMatchObject({
          policy: { workspaceId: "ws-work", screenshotCopy: "auto" },
        });
        expect(workspace).toHaveBeenCalledOnce();
      });

      it("the in-memory editor after a failed save gets the policy, not a fresh read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        prefs = { copy: "manual" };
        const { handler, saveToVault } = setup(shot("capture"));
        saveToVault.mockRejectedValueOnce(new Error("disk full"));
        const out = await handler({ mode: "frame" });
        prefs = { copy: "auto" };
        expect(out).toMatchObject({
          kind: "captured",
          after: "editor",
          saved: null,
          policy: { workspaceId: "ws-work", screenshotCopy: "manual" },
        });
      });

      it("the retained bytes carry the policy for the toast's Save and Annotate", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        prefs = { copy: "auto" };
        const { handler, saveToVault } = setup(shot("copy"));
        saveToVault.mockRejectedValueOnce(new Error("disk full"));
        await handler({ mode: "frame" });
        prefs = { copy: "manual" };
        expect(takeLastQuietCapture()?.policy).toEqual({
          workspaceId: "ws-work",
          screenshotCopy: "auto",
        });
      });

      it("opens the editor and copies nothing when the settings could not be read at the start", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { handler, copyToClipboard } = setup(shot("capture"));
        prefs = new Proxy(prefs, {
          get() {
            throw new Error("settings unavailable");
          },
        });
        const out = await handler({ mode: "frame" });
        expect(out).toMatchObject({ kind: "captured", after: "editor", policy: null });
        expect(copyToClipboard).not.toHaveBeenCalled();
      });
    });

    it("Copy whose save fails still copies and keeps the bytes once for Edit", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { handler, saveToVault, onQuietCapture } = setup(shot("copy"));
      saveToVault.mockRejectedValueOnce(new Error("disk full"));
      const out = await handler({ mode: "window" });
      expect(out).toMatchObject({ after: "quiet", saved: null, copied: true });
      expect(onQuietCapture).toHaveBeenCalledWith(expect.objectContaining({ saved: null }));
      // Copied but not saved is not a "Copied" confirmation: the card must keep Save.
      expect(onQuietCapture.mock.calls[0]?.[0]).not.toHaveProperty("presentation");
      expect(takeLastQuietCapture()).toEqual({
        png: Buffer.from([9, 8, 7]),
        width: 3,
        height: 2,
        mode: "window",
        workspaceId: "ws-work",
        policy: { workspaceId: "ws-work", screenshotCopy: "manual" },
      });
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("Copy that lands nowhere falls back to the editor with the bytes", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { handler, saveToVault, copyToClipboard, onQuietCapture } = setup(shot("copy"));
      saveToVault.mockRejectedValueOnce(new Error("disk full"));
      copyToClipboard.mockImplementationOnce(() => {
        throw new Error("clipboard busy");
      });
      const out = await handler({ mode: "frame" });
      if (out.kind !== "captured") throw new Error("unreachable");
      expect(out.after).toBe("editor");
      expect(new Uint8Array(out.png)).toEqual(new Uint8Array([9, 8, 7]));
      expect(onQuietCapture).not.toHaveBeenCalled();
    });

    it("starting a capture frees the bytes kept by the previous one", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const first = setup(shot("copy"));
      first.saveToVault.mockRejectedValueOnce(new Error("disk full"));
      await first.handler({ mode: "frame" });
      const cancelled = setup(async () => ({ kind: "cancelled" }));
      await cancelled.handler({ mode: "frame" });
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("reports after: quiet for Copy, with the mode the user ended in", async () => {
      const { handler, track } = setup(shot("copy"));
      await handler({ mode: "screen" });
      expect(track).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "screen", outcome: "captured", after: "quiet" }),
      );
    });

    it("remembers the mode on a Copy and on a Capture whose save failed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const quiet = setup(shot("copy"));
      await quiet.handler({ mode: "screen" });
      expect(quiet.rememberMode).toHaveBeenCalledExactlyOnceWith("screen");

      const fallback = setup(shot("capture"));
      fallback.saveToVault.mockRejectedValueOnce(new Error("disk full"));
      const out = await fallback.handler({ mode: "window" });
      expect(out).toMatchObject({ kind: "captured", after: "editor" });
      expect(fallback.rememberMode).toHaveBeenCalledExactlyOnceWith("window");
    });
  });
});

describe("createCaptureHandler — a screenshot during a take (NIW2-688)", () => {
  const shot = async (): Promise<ProviderResult> => ({
    kind: "captured",
    png: Buffer.from("png"),
    mode: "frame",
    action: "capture",
  });

  it("saves to the vault, shows the notice and never opens the editor, even with Editor as the destination", async () => {
    takeNow = true;
    prefs = { copy: "manual", afterCapture: "editor" };
    const { handler, saveToVault, onQuietCapture, windows } = setup(shot);
    const answer = await handler({ mode: "frame" });
    expect(saveToVault).toHaveBeenCalledOnce();
    expect(answer).toMatchObject({ kind: "captured", after: "quiet" });
    expect(onQuietCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: "taken",
        saved: { id: "screenshot-1", assetId: "asset-1" },
      }),
    );
    expect(windows.afterCapture).toHaveBeenCalledWith("quiet");
  });

  it("passes the take target to the provider without changing the idle screenshot mode", async () => {
    takeNow = true;
    const capture = vi.fn(shot);
    const { handler, rememberMode } = setup(capture);
    await handler({ mode: "frame" });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingTarget: { displayId: 2, rect: null },
      }),
    );
    expect(rememberMode).not.toHaveBeenCalled();
  });

  it("cancels instead of falling back to the selector when the take target is unavailable", async () => {
    takeNow = true;
    const capture = vi.fn(shot);
    const { handler, recordingTarget } = setup(capture);
    recordingTarget.mockResolvedValue(null as never);
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("still applies the copy setting", async () => {
    takeNow = true;
    prefs = { copy: "auto" };
    const { handler, copyToClipboard } = setup(shot);
    await handler({ mode: "frame" });
    expect(copyToClipboard).toHaveBeenCalledOnce();
  });

  it("a failed save keeps the shot in the toast instead of opening the editor", async () => {
    takeNow = true;
    const { handler, saveToVault, onQuietCapture } = setup(shot);
    saveToVault.mockRejectedValue(new Error("vault closed"));
    const answer = await handler({ mode: "frame" });
    expect(answer).toMatchObject({ kind: "captured", after: "quiet", saved: null });
    expect(onQuietCapture).toHaveBeenCalledWith(
      expect.objectContaining({ presentation: "taken", saved: null }),
    );
    expect(takeLastQuietCapture()).not.toBeNull();
  });

  it("outside a take nothing changes: the notice is not used and the editor still opens", async () => {
    prefs = { copy: "manual", afterCapture: "editor" };
    const { handler, onQuietCapture } = setup(shot);
    const answer = await handler({ mode: "frame" });
    expect(answer).toMatchObject({ kind: "captured", after: "editor" });
    expect(onQuietCapture).not.toHaveBeenCalled();
  });

  it("a plain quiet capture outside a take carries no presentation", async () => {
    const { handler, onQuietCapture } = setup(shot);
    await handler({ mode: "frame" });
    expect(onQuietCapture.mock.calls[0]![0]).not.toHaveProperty("presentation");
  });
});

describe("createCaptureHandler — insert into the open editor", () => {
  const shot = (action: CaptureAction = "capture"): ProviderResult => ({
    kind: "captured",
    png: Buffer.from([1, 2, 3]),
    mode: "frame",
    action,
  });

  it("returns the bytes with saved null and copied false even when the policy would save and copy", async () => {
    prefs = { copy: "auto", afterCapture: "preview" };
    const { handler, windows, rememberMode } = setup(async () => shot("copy"));
    const result = await handler({ mode: "frame", insert: true });
    expect(result).toMatchObject({
      kind: "captured",
      after: "editor",
      width: 3,
      height: 2,
      mode: "frame",
      saved: null,
      copied: false,
      policy: null,
    });
    expect(result.kind === "captured" && new Uint8Array(result.png)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(windows.afterCapture).toHaveBeenCalledWith("editor");
    expect(rememberMode).toHaveBeenCalledWith("frame");
  });

  it("keeps the quiet capture the toast holds for its Save retry", async () => {
    keepLastQuietCapture({
      png: Buffer.from([9, 8, 7]),
      width: 3,
      height: 1,
      mode: "frame",
      workspaceId: null,
      policy: { workspaceId: null, screenshotCopy: "auto" },
    });
    const { handler } = setup(async () => shot());
    await handler({ mode: "frame", insert: true });
    expect(takeLastQuietCapture()?.png).toEqual(Buffer.from([9, 8, 7]));
  });

  it("never saves, copies or toasts", async () => {
    prefs = { copy: "auto", afterCapture: "preview" };
    const { handler, saveToVault, copyToClipboard, onQuietCapture } = setup(async () =>
      shot("copy"),
    );
    await handler({ mode: "frame", insert: true });
    expect(saveToVault).not.toHaveBeenCalled();
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(onQuietCapture).not.toHaveBeenCalled();
  });

  it("answers cancelled during a take without opening the overlay or hiding windows", async () => {
    takeNow = true;
    const capture = vi.fn(async () => shot());
    const { handler, windows } = setup(capture);
    expect(await handler({ mode: "frame", insert: true })).toEqual({ kind: "cancelled" });
    expect(capture).not.toHaveBeenCalled();
    expect(windows.beforeCapture).not.toHaveBeenCalled();
    expect(windows.afterCapture).not.toHaveBeenCalled();
  });

  it("is not reported as a capture: adding an image is not opening the editor", async () => {
    const { handler, track } = setup(async () => shot());
    await handler({ mode: "frame", insert: true });
    expect(track).not.toHaveBeenCalled();
  });

  it("still reports an insert that failed", async () => {
    const { handler, track } = setup(async () => {
      throw new Error("capture broke");
    });
    expect(await handler({ mode: "frame", insert: true })).toEqual({ kind: "cancelled" });
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("never starts a recording when the overlay's Record switch answers an insert", async () => {
    const { handler, onRecordTarget, windows } = setup(async () => ({
      kind: "record",
      start: true,
      displayId: 2,
      rect: { x: 100, y: 50, width: 640, height: 360 },
    }));
    expect(await handler({ mode: "frame", insert: true })).toEqual({ kind: "cancelled" });
    expect(onRecordTarget).not.toHaveBeenCalled();
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
  });

  it("refuses an insert that is not a boolean", async () => {
    const capture = vi.fn();
    const { handler } = setup(capture);
    await expect(handler({ mode: "frame", insert: "yes" })).rejects.toThrow(/insert/);
    expect(capture).not.toHaveBeenCalled();
  });
});
