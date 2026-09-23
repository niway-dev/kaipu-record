import { afterEach, describe, expect, it } from "vitest";
import { focusInspectorFirstControl } from "./focus-inspector";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("focusInspectorFirstControl", () => {
  it("focuses the first enabled control inside the inspector", () => {
    document.body.innerHTML = `
      <aside data-testid="editor-inspector">
        <input id="level" type="range" />
        <button id="reset">Reset</button>
      </aside>
    `;
    expect(focusInspectorFirstControl()).toBe(true);
    expect(document.activeElement?.id).toBe("level");
  });

  it("skips a disabled first control and focuses the next one", () => {
    document.body.innerHTML = `
      <aside data-testid="editor-inspector">
        <button id="disabled" disabled>Locked</button>
        <input id="smoothing" type="range" />
      </aside>
    `;
    expect(focusInspectorFirstControl()).toBe(true);
    expect(document.activeElement?.id).toBe("smoothing");
  });

  it("returns false when the inspector is not in the document", () => {
    document.body.innerHTML = `<div>no inspector here</div>`;
    expect(focusInspectorFirstControl()).toBe(false);
  });

  it("ignores controls that live outside the inspector", () => {
    document.body.innerHTML = `
      <input id="outside" />
      <aside data-testid="editor-inspector">
        <input id="inside" />
      </aside>
    `;
    expect(focusInspectorFirstControl()).toBe(true);
    expect(document.activeElement?.id).toBe("inside");
  });
});
