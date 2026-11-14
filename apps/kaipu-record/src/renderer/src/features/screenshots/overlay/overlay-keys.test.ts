import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionForKey,
  copyKeyLabel,
  detectKeyPlatform,
  recordKeyLabel,
  toggleForKey,
} from "./overlay-keys";

const api = window.electronAPI as { platform: string };
const original = api.platform;

afterEach(() => {
  api.platform = original;
  vi.unstubAllGlobals();
});

describe("detectKeyPlatform", () => {
  it("reads the preload bridge, not the browser's report", () => {
    // A Mac-looking navigator must not win over a bridge that says Windows.
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    api.platform = "win32";
    expect(detectKeyPlatform()).toBe("other");
    expect(copyKeyLabel(detectKeyPlatform())).toBe("Ctrl+C");

    api.platform = "darwin";
    expect(detectKeyPlatform()).toBe("mac");
    expect(copyKeyLabel(detectKeyPlatform())).toBe("⌘C");
  });

  it("falls back to the browser only when the bridge reports nothing", () => {
    api.platform = "";
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32" });
    expect(detectKeyPlatform()).toBe("other");
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    expect(detectKeyPlatform()).toBe("mac");
  });
});

describe("actionForKey", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("Enter takes the screenshot when the overlay opened to capture", () => {
    expect(actionForKey(key({ key: "Enter" }), "mac", "capture")).toBe("capture");
  });

  it("Enter starts the recording when the overlay opened to record", () => {
    expect(actionForKey(key({ key: "Enter" }), "mac", "record")).toBe("record");
    expect(actionForKey(key({ key: "Enter" }), "other", "record")).toBe("record");
  });

  it("no key answers Use selection any more: the overlay carries the audio toggles", () => {
    for (const name of ["Enter", "r", "c", "s", " "]) {
      for (const intent of ["capture", "record"] as const) {
        expect(actionForKey(key({ key: name }), "mac", intent)).not.toBe("select");
        expect(actionForKey(key({ key: name, metaKey: true }), "mac", intent)).not.toBe("select");
      }
    }
  });

  it("Enter with a modifier is not a confirm", () => {
    expect(actionForKey(key({ key: "Enter", shiftKey: true }), "mac", "record")).toBeNull();
    expect(actionForKey(key({ key: "Enter", metaKey: true }), "mac", "capture")).toBeNull();
  });

  it("R alone records only in the record intent; a screenshot overlay ignores it", () => {
    expect(actionForKey(key({ key: "r" }), "mac", "capture")).toBeNull();
    expect(actionForKey(key({ key: "R" }), "other", "record")).toBe("record");
    expect(actionForKey(key({ key: "r" }), "mac", "record")).toBe("record");
  });

  it("⌘R and Ctrl+R are not Record: packaged builds swallow them before the page", () => {
    // @electron-toolkit's watchWindowShortcuts preventDefaults Ctrl/Cmd+R outside dev.
    expect(actionForKey(key({ key: "r", metaKey: true }), "mac", "record")).toBeNull();
    expect(actionForKey(key({ key: "r", ctrlKey: true }), "other", "record")).toBeNull();
    expect(actionForKey(key({ key: "r", altKey: true }), "mac", "record")).toBeNull();
  });

  it("⌘C copies only when the overlay opened to capture", () => {
    expect(actionForKey(key({ key: "c", metaKey: true }), "mac", "capture")).toBe("copy");
    expect(actionForKey(key({ key: "c", metaKey: true }), "mac", "record")).toBeNull();
  });

  it("prints the record key per platform", () => {
    expect(recordKeyLabel("mac")).toBe("R");
    expect(recordKeyLabel("other")).toBe("R");
  });
});

describe("toggleForKey", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("M, A and W toggle the microphone, system audio and camera while recording", () => {
    expect(toggleForKey(key({ key: "m" }), "record")).toBe("isMicrophoneEnabled");
    expect(toggleForKey(key({ key: "A" }), "record")).toBe("isSystemAudioEnabled");
    expect(toggleForKey(key({ key: "w" }), "record")).toBe("isCameraEnabled");
  });

  it("does nothing in the screenshot intent", () => {
    for (const name of ["m", "a", "w"]) {
      expect(toggleForKey(key({ key: name }), "capture")).toBeNull();
    }
  });

  it("ignores key repeat, so a held key flips an input once", () => {
    expect(toggleForKey(key({ key: "m", repeat: true }), "record")).toBeNull();
  });

  it("ignores any press with a modifier, so ⌘M, Ctrl+A and Shift+W do not toggle", () => {
    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      expect(toggleForKey(key({ key: "m", ...init }), "record")).toBeNull();
      expect(toggleForKey(key({ key: "a", ...init }), "record")).toBeNull();
      expect(toggleForKey(key({ key: "w", ...init }), "record")).toBeNull();
    }
  });

  it("ignores events from editable controls", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const field = document.createElement(tag);
      document.body.append(field);
      const event = new KeyboardEvent("keydown", { key: "m", bubbles: true });
      field.dispatchEvent(event);
      expect(toggleForKey(event, "record")).toBeNull();
      field.remove();
    }
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    const event = new KeyboardEvent("keydown", { key: "w", bubbles: true });
    editable.dispatchEvent(event);
    expect(toggleForKey(event, "record")).toBeNull();
    editable.remove();
  });

  it("does not touch the other keys: Enter, R, P, V, C, 1 and 2", () => {
    for (const name of ["Enter", "r", "p", "v", "1", "2", "c"]) {
      expect(toggleForKey(key({ key: name }), "record")).toBeNull();
    }
  });
});
