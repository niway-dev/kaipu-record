import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SettingsDrawer } from "./settings-drawer";

function renderDrawer(variant: "panel" | "page", scrollIntoView: ReturnType<typeof vi.fn>) {
  Element.prototype.scrollIntoView = scrollIntoView as never;
  return render(
    <SettingsDrawer id="d" label="Microphone" open variant={variant} onKeyDown={() => {}}>
      <p>content</p>
    </SettingsDrawer>,
  );
}

describe("SettingsDrawer", () => {
  const original = Element.prototype.scrollIntoView;
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("brings the page drawer into view when it opens", () => {
    const scrollIntoView = vi.fn();
    renderDrawer("page", scrollIntoView);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("leaves the panel drawer alone: the panel grows its window instead", () => {
    const scrollIntoView = vi.fn();
    renderDrawer("panel", scrollIntoView);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
