import { afterEach, describe, expect, it } from "vitest";
import { pasteShortcutLabel } from "./use-paste-to-editor";

const api = window.electronAPI as { platform: string };
const original = api.platform;

afterEach(() => {
  api.platform = original;
});

describe("pasteShortcutLabel", () => {
  it("prints the paste chord for the platform the bridge reports", () => {
    api.platform = "darwin";
    expect(pasteShortcutLabel()).toBe("⌘V");
    api.platform = "win32";
    expect(pasteShortcutLabel()).toBe("Ctrl+V");
  });
});
