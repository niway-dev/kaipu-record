import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

// The toolbar of the owner's mock (NIW2-711): B1 layout, B2 tooltips and keys, B3 compact.
const flags: Record<string, boolean> = {};
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => flags[name] ?? false,
}));
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene: vi.fn(async () => new ArrayBuffer(1)),
  clearExportCache: vi.fn(),
}));
// Inspect decodes pixels with a real canvas, which jsdom lacks.
vi.mock("@renderer/features/screenshots/inspect/pixel-buffer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/screenshots/inspect/pixel-buffer")>()),
  decodeSrgbBuffer: vi.fn(async () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) })),
  probeCaptured: vi.fn(async () => null),
}));

/** A ResizeObserver the test drives: `setPageWidth` reports a width to the page's observer. */
const observers: Array<{ cb: ResizeObserverCallback; targets: Element[] }> = [];
class FakeResizeObserver {
  private readonly entry: { cb: ResizeObserverCallback; targets: Element[] };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element): void {
    this.entry.targets.push(el);
  }
  unobserve(): void {}
  disconnect(): void {
    this.entry.targets = [];
  }
}
const originalRO = globalThis.ResizeObserver;

function setPageWidth(width: number): void {
  const page = document.querySelector('[data-ui-area$=".page"]');
  act(() => {
    for (const o of observers) {
      if (page && o.targets.includes(page)) {
        o.cb(
          [{ target: page, contentRect: { width } } as unknown as ResizeObserverEntry],
          {} as never,
        );
      }
    }
  });
}

const bytes = new Uint8Array([1, 2, 3]).buffer;
const PASTE: ImageSource = { kind: "blob", bytes, width: 4, height: 4, origin: "paste" };

beforeEach(async () => {
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    locale: "en" as const,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
  observers.length = 0;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});
afterEach(() => {
  for (const k of Object.keys(flags)) delete flags[k];
  getToasts().forEach((x) => dismissToast(x.id));
  globalThis.ResizeObserver = originalRO;
});

async function mount(on: string[] = []): Promise<void> {
  for (const name of on) flags[name] = true;
  const router = createMemoryRouter(
    [{ path: "/editor/capture", element: <ScreenshotEditorPage /> }],
    { initialEntries: [{ pathname: "/editor/capture", state: PASTE }] },
  );
  render(<RouterProvider router={router} />);
  fireEvent.load(await screen.findByRole("img"));
}
const ALL = ["image-canvas", "image-inspect", "image-text"];

const toolbar = (): HTMLElement => screen.getByRole("toolbar", { name: "Editor toolbar" });
const btn = (name: string): HTMLElement => within(toolbar()).getByRole("button", { name });
const maybeBtn = (name: string): HTMLElement | null =>
  within(toolbar()).queryByRole("button", { name });
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ...init });
const isActive = (name: string): boolean => /toolActive/.test(btn(name).className);
const buttonLabels = (): string[] =>
  within(toolbar())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") || b.textContent || b.getAttribute("title") || "");

describe("toolbar B1: layout", () => {
  it("lists the controls in the mock's order with every flag on", async () => {
    await mount(ALL);
    expect(buttonLabels()).toEqual([
      "Annotate (Esc)",
      "Inspect (I)",
      "Select",
      "Pen",
      "Box",
      "Arrow",
      "Text",
      "Step",
      "Redact",
      "Export frame",
      "Add image",
      "Select text",
      "Undo",
      "Redo",
      "Copy",
      "Save",
      "Export",
      "PDF",
    ]);
    expect(screen.getByRole("textbox", { name: /title/i })).toBeInTheDocument();
  });

  it("puts dividers after the mode switch, before Redact, before Export frame and before Undo", async () => {
    await mount(ALL);
    const dividers = toolbar().querySelectorAll('[class*="divider"]');
    expect(dividers).toHaveLength(4);
    const before = (name: string): Element | null =>
      (btn(name).closest('[class*="tipWrap"]') ?? btn(name)).previousElementSibling;
    expect(before("Redact")?.className).toMatch(/divider/);
    expect(before("Export frame")?.className).toMatch(/divider/);
    expect(before("Undo")?.className).toMatch(/divider/);
  });

  it("keeps the mode switch's names and the ui-map area on the Inspect segment", async () => {
    await mount(ALL);
    expect(btn("Annotate (Esc)")).toHaveAttribute("aria-pressed", "true");
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "false");
    expect(btn("Inspect (I)")).toHaveAttribute("data-ui-area", "editorImage.inspectToggle");
    fireEvent.click(btn("Inspect (I)"));
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "true");
    expect(btn("Annotate (Esc)")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn("Annotate (Esc)"));
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no mode switch, Add image or Select text with the flags off, and old tool names", async () => {
    await mount();
    expect(buttonLabels()).toEqual([
      "Select",
      "Pen",
      "Box",
      "Arrow",
      "Text",
      "Step",
      "Blur",
      "Crop",
      "Undo",
      "Redo",
      "Copy",
      "Save",
      "PDF",
    ]);
  });

  it("opens the Add image menu from its toolbar button", async () => {
    await mount(["image-canvas"]);
    fireEvent.click(btn("Add image"));
    expect(screen.getByRole("menu", { name: "Add image options" })).toBeInTheDocument();
  });
});

describe("toolbar B2: tooltips", () => {
  it("shows the label and the key on hover, and hides them on leave", async () => {
    await mount();
    const step = btn("Step");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(step);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Step");
    expect(within(tip).getByText("N").tagName).toBe("KBD");
    fireEvent.mouseLeave(step);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the same tooltip on keyboard focus, but not on a mouse click's focus", async () => {
    await mount();
    // jsdom does not model focus-visible: say the focus came from the keyboard, then from a click.
    const realMatches = Element.prototype.matches;
    let keyboard = true;
    const matches = vi.spyOn(Element.prototype, "matches");
    matches.mockImplementation(function (this: Element, selector: string) {
      return selector === ":focus-visible" ? keyboard : realMatches.call(this, selector);
    });
    act(() => btn("Pen").focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Pen");
    act(() => btn("Pen").blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
    keyboard = false;
    act(() => btn("Pen").focus());
    expect(screen.queryByRole("tooltip")).toBeNull();
    matches.mockRestore();
  });

  it("sets aria-keyshortcuts and keeps aria-label as the plain label", async () => {
    await mount(ALL);
    const keys: Array<[string, string]> = [
      ["Select", "V"],
      ["Pen", "P"],
      ["Box", "R"],
      ["Arrow", "A"],
      ["Text", "T"],
      ["Step", "N"],
      ["Redact", "B"],
      ["Export frame", "X"],
      ["Add image", "M"],
    ];
    for (const [name, key] of keys) {
      expect(btn(name)).toHaveAttribute("aria-label", name);
      expect(btn(name)).toHaveAttribute("aria-keyshortcuts", key);
    }
  });
});

describe("toolbar B2: keys", () => {
  const TOOL_KEYS: Array<[string, string]> = [
    ["v", "Select"],
    ["p", "Pen"],
    ["r", "Box"],
    ["a", "Arrow"],
    ["t", "Text"],
    ["n", "Step"],
    ["b", "Redact"],
    ["x", "Export frame"],
  ];

  it.each(TOOL_KEYS)("%s picks %s", async (key, name) => {
    await mount(ALL);
    press("v");
    if (key === "v") press("p"); // start from another tool so the pick is visible
    press(key);
    expect(isActive(name)).toBe(true);
  });

  it("accepts a capital letter (Caps Lock)", async () => {
    await mount();
    press("N");
    expect(isActive("Step")).toBe(true);
  });

  it("opens the Add image menu with M in canvas mode", async () => {
    await mount(["image-canvas"]);
    press("m");
    expect(screen.getByRole("menu", { name: "Add image options" })).toBeInTheDocument();
  });

  it("does nothing for M with the flags off", async () => {
    await mount();
    press("m");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(isActive("Select")).toBe(true);
  });

  it("is ignored while typing in an input", async () => {
    await mount();
    const title = screen.getByRole("textbox", { name: /title/i });
    fireEvent.keyDown(title, { key: "n" });
    expect(isActive("Select")).toBe(true);
    expect(isActive("Step")).toBe(false);
  });

  it("is ignored while an annotation's text is being edited (a textarea or contenteditable)", async () => {
    await mount();
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    fireEvent.keyDown(area, { key: "n" });
    area.remove();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: "n" });
    editable.remove();
    expect(isActive("Select")).toBe(true);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { altKey: true }])(
    "is ignored with a modifier held (%o)",
    async (modifier) => {
      await mount();
      press("n", modifier);
      expect(isActive("Select")).toBe(true);
    },
  );

  it("is ignored while a menu is open", async () => {
    await mount(["image-canvas"]);
    fireEvent.click(btn("Add image"));
    press("n");
    expect(isActive("Select")).toBe(true);
  });

  it("is ignored while a dialog is open", async () => {
    await mount();
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    press("n");
    dialog.remove();
    expect(isActive("Select")).toBe(true);
  });

  it("switches from Inspect to Annotate and picks the tool", async () => {
    await mount(ALL);
    fireEvent.click(btn("Inspect (I)"));
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "true");
    press("b");
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "false");
    expect(isActive("Redact")).toBe(true);
  });

  it("M leaves Inspect before opening Add image, so the menu is not inside the hidden toolbar", async () => {
    await mount(ALL);
    setPageWidth(1400);
    fireEvent.click(btn("Inspect (I)"));
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "true");
    press("m");
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("shows no tool as active while Inspect is on, and Esc returns to Annotate", async () => {
    await mount(ALL);
    fireEvent.click(btn("Inspect (I)"));
    expect(isActive("Select")).toBe(false);
    press("Escape");
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "false");
    expect(isActive("Select")).toBe(true);
  });

  it("leaves Inspect's own keys alone: I toggles Inspect and picks no tool", async () => {
    await mount(ALL);
    press("i");
    expect(btn("Inspect (I)")).toHaveAttribute("aria-pressed", "true");
  });
});

/** Mounts the editor and draws an export frame at full width; returns the canvas view. */
async function drawExportFrame(): Promise<Element> {
  const originalRect = Element.prototype.getBoundingClientRect;
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  for (const prop of ["naturalWidth", "naturalHeight"]) {
    Object.defineProperty(HTMLImageElement.prototype, prop, {
      configurable: true,
      get: () => 400,
    });
  }
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }) as DOMRect;
  Element.prototype.setPointerCapture = vi.fn();
  onTestFinished(() => {
    for (const prop of ["clientWidth", "clientHeight"]) {
      Reflect.deleteProperty(HTMLElement.prototype, prop);
    }
    for (const prop of ["naturalWidth", "naturalHeight"]) {
      Reflect.deleteProperty(HTMLImageElement.prototype, prop);
    }
    Element.prototype.getBoundingClientRect = originalRect;
    // @ts-expect-error — jsdom has no pointer capture; the test stubbed it
    delete Element.prototype.setPointerCapture;
  });
  await mount(ALL);
  fireEvent.click(btn("Export frame"));
  const overlay = await waitFor(() => {
    const el = document.querySelector('[class*="overlay"]');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  fireEvent.pointerDown(overlay, { clientX: 20, clientY: 20, pointerId: 3 });
  fireEvent.pointerMove(overlay, { clientX: 120, clientY: 100, pointerId: 3 });
  fireEvent.pointerUp(overlay, { pointerId: 3 });
  const view = document.querySelector('[data-ui-area="editorImage.canvasView"]')!;
  await waitFor(() => expect(view.getAttribute("data-export-frame")).toBe("true"));
  return view;
}

describe("toolbar B3: compact", () => {
  it("is the full toolbar until the page reports a width under 1000 px", async () => {
    await mount(ALL);
    expect(maybeBtn("Pen")).not.toBeNull();
    setPageWidth(1000);
    expect(maybeBtn("Pen")).not.toBeNull();
    setPageWidth(999);
    expect(maybeBtn("Pen")).toBeNull();
  });

  it("folds Pen, Box, Arrow, Text and Step into a Draw menu", async () => {
    await mount(ALL);
    setPageWidth(900);
    expect(buttonLabels().slice(0, 5)).toEqual([
      "Annotate (Esc)",
      "Inspect (I)",
      "Select",
      "Draw",
      "Redact",
    ]);
    for (const name of ["Pen", "Box", "Arrow", "Text", "Step"]) expect(maybeBtn(name)).toBeNull();
    fireEvent.click(btn("Draw"));
    const menu = screen.getByRole("menu", { name: "Drawing tools" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["PenP", "BoxR", "ArrowA", "TextT", "StepN"]);
  });

  it("picks a drawing tool from the Draw menu and shows it as active", async () => {
    await mount(ALL);
    setPageWidth(900);
    expect(btn("Draw").className).not.toMatch(/menuButtonActive/);
    fireEvent.click(btn("Draw"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Arrow/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(btn("Draw").className).toMatch(/menuButtonActive/);
  });

  it("keeps the keys working", async () => {
    await mount(ALL);
    setPageWidth(900);
    press("a");
    expect(btn("Draw").className).toMatch(/menuButtonActive/);
    press("v");
    expect(btn("Draw").className).not.toMatch(/menuButtonActive/);
    expect(isActive("Select")).toBe(true);
    press("b");
    expect(isActive("Redact")).toBe(true);
  });

  it("folds Export frame, Add image, Select text, Undo, Redo and PDF into a More menu", async () => {
    await mount(ALL);
    setPageWidth(900);
    for (const name of ["Export frame", "Add image", "Select text", "Undo", "Redo", "PDF"]) {
      expect(maybeBtn(name)).toBeNull();
    }
    fireEvent.click(btn("More"));
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Export frameX", "Add imageM", "Select text", "Undo⌘Z", "Redo⇧⌘Z", "PDF"]);
  });

  it("opens the Add image menu from the More menu", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Add image/ }));
    expect(screen.getByRole("menu", { name: "Add image options" })).toBeInTheDocument();
  });

  it("picks Export frame from the More menu", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("More"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Export frame/ }));
    // The card is the Tool tab's content, so it waits in the sheet (which stays closed until asked).
    expect(screen.queryByRole("button", { name: "Fit to content" })).toBeNull();
    fireEvent.click(btn("Panel"));
    expect(screen.getByRole("tab", { name: "Tool" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Fit to content" })).toBeInTheDocument();
  });

  it("closes a menu with Esc", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Draw"));
    press("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes a menu with Esc without clearing the export frame", async () => {
    const view = await drawExportFrame();
    setPageWidth(900);
    fireEvent.click(btn("Draw"));
    press("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.getAttribute("data-export-frame")).toBe("true");
  });

  it("closes the Add image menu with Esc without clearing the export frame", async () => {
    const view = await drawExportFrame();
    press("m");
    expect(screen.getByRole("menu", { name: "Add image options" })).toBeInTheDocument();
    press("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.getAttribute("data-export-frame")).toBe("true");
  });

  it("closes the sheet with Esc without clearing the export frame", async () => {
    const view = await drawExportFrame();
    setPageWidth(900);
    fireEvent.click(btn("Panel"));
    expect(screen.getByText("Beautify")).toBeInTheDocument();
    press("Escape");
    expect(screen.queryByText("Beautify")).toBeNull();
    expect(view.getAttribute("data-export-frame")).toBe("true");
  });

  it("closes only the open menu with Esc while the sheet is open, then the sheet with the next Esc", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Panel"));
    fireEvent.click(btn("Draw"));
    press("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByText("Beautify")).toBeInTheDocument();
    press("Escape");
    expect(screen.queryByText("Beautify")).toBeNull();
  });

  it("returns focus to the menu button when the menu closes by Esc or by picking an item", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Draw"));
    press("Escape");
    expect(document.activeElement).toBe(btn("Draw"));
    fireEvent.click(btn("Draw"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Arrow/ }));
    expect(document.activeElement).toBe(btn("Draw"));
  });

  it("turns Colors off when the sheet closes, so the next press opens it again", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Inspect (I)"));
    // The Inspect controls, Colors among them, are the Tool tab's content: open the sheet for them.
    fireEvent.click(btn("Panel"));
    const colorsBtn = () => screen.getByRole("button", { name: "Colors" });
    fireEvent.click(colorsBtn());
    expect(screen.getByRole("tab", { name: "Colors" })).toHaveAttribute("aria-selected", "true");
    press("Escape");
    expect(screen.queryByText("Beautify")).toBeNull();
    fireEvent.click(btn("Panel"));
    fireEvent.click(screen.getByRole("tab", { name: "Tool" }));
    expect(colorsBtn()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(colorsBtn());
    expect(screen.getByRole("tab", { name: "Colors" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes the sheet with Esc while a Beautify range slider has focus", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Panel"));
    const slider = document.querySelector<HTMLInputElement>('[class*="sheet"] input[type="range"]');
    expect(slider).not.toBeNull();
    slider!.focus();
    fireEvent.keyDown(slider!, { key: "Escape" });
    expect(screen.queryByText("Beautify")).toBeNull();
  });

  it("hides the title, keeps Save's label and makes Copy an icon", async () => {
    await mount(ALL);
    setPageWidth(900);
    expect(screen.queryByRole("textbox", { name: /title/i })).toBeNull();
    expect(btn("Save")).toHaveTextContent("Save");
    expect(btn("Copy")).toHaveAttribute("aria-label", "Copy");
    expect(btn("Inspect (I)")).toHaveTextContent("");
  });

  it("collapses the right panel behind a toggle that opens and closes a sheet", async () => {
    await mount(ALL);
    expect(screen.getByText("Beautify")).toBeInTheDocument();
    setPageWidth(900);
    expect(screen.queryByText("Beautify")).toBeNull();
    const toggle = btn("Panel");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByText("Beautify")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByText("Beautify")).toBeNull();
  });

  it("closes the sheet with Esc and with a click on the stage", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Panel"));
    press("Escape");
    expect(screen.queryByText("Beautify")).toBeNull();
    fireEvent.click(btn("Panel"));
    const scrim = document.querySelector('[class*="sheetScrim"]')!;
    fireEvent.click(scrim);
    expect(screen.queryByText("Beautify")).toBeNull();
    expect(btn("Panel")).toHaveAttribute("aria-expanded", "false");
  });

  it("returns to the full toolbar and the panel in the flow when the page widens", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Panel"));
    setPageWidth(1300);
    expect(maybeBtn("Pen")).not.toBeNull();
    expect(maybeBtn("Panel")).toBeNull();
    expect(screen.getByText("Beautify")).toBeInTheDocument();
  });

  it("holds the Inspect colors panel in the sheet, opening it, instead of floating over the stage", async () => {
    await mount(ALL);
    setPageWidth(900);
    const colorsPanel = () => document.querySelector('[data-ui-area="editorImage.inspectColors"]');
    fireEvent.click(btn("Inspect (I)"));
    expect(colorsPanel()).toBeNull();
    expect(btn("Panel")).toHaveAttribute("aria-expanded", "false");
    // The Colors button is in the Tool tab, so the sheet is opened to reach it.
    fireEvent.click(btn("Panel"));
    fireEvent.click(screen.getByRole("button", { name: "Colors" }));
    expect(colorsPanel()).not.toBeNull();
    // It is in the sheet, with Beautify.
    expect(colorsPanel()!.closest('[class*="sheet"]')).not.toBeNull();
    expect(btn("Panel")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Beautify")).toBeInTheDocument();
    // Closing the sheet takes the panel with it.
    fireEvent.click(btn("Panel"));
    expect(colorsPanel()).toBeNull();
  });

  it("holds the Inspect colors panel in the side panel's Colors tab in the full layout", async () => {
    await mount(ALL);
    fireEvent.click(btn("Inspect (I)"));
    fireEvent.click(screen.getByRole("button", { name: "Colors" }));
    const panel = document.querySelector('[data-ui-area="editorImage.inspectColors"]');
    expect(panel).not.toBeNull();
    // In the side panel under its tab, not in the sheet and not floating over the stage.
    expect(screen.getByRole("tab", { name: "Colors" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toContainElement(panel as HTMLElement);
    expect(panel!.closest('[class*="sheet"]')).toBeNull();
    expect(panel!.closest('[data-ui-area="editorImage.canvas"]')).toBeNull();
  });

  it("marks the toolbar and the map areas", async () => {
    await mount(ALL);
    setPageWidth(900);
    expect(toolbar()).toHaveAttribute("data-compact", "true");
    for (const area of ["drawMenu", "moreMenu", "panelToggle"]) {
      expect(document.querySelector(`[data-ui-area="editorImage.${area}"]`)).not.toBeNull();
    }
  });
});

// NIW2-723: each tool's options moved from the top bar and the stage popover into the side
// panel's Tool tab, which follows the active tool and the selection like the video editor's
// inspector.
describe("tool panel: the Tool tab of the side panel", () => {
  const tab = (name: string): HTMLElement => screen.getByRole("tab", { name });
  const panel = (): HTMLElement => screen.getByRole("tabpanel");
  const toolPanelState = (): string | null =>
    document.querySelector('[data-ui-area="editorImage.toolPanel"]')?.getAttribute("data-state") ??
    null;

  it("opens on Beautify, and the Tool tab says no tool is selected", async () => {
    await mount(ALL);
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tab("Tool"));
    expect(toolPanelState()).toBe("empty");
    expect(within(panel()).getByText("No tool selected")).toBeInTheDocument();
    expect(
      within(panel()).getByText("Pick a tool in the toolbar to see its options here."),
    ).toBeInTheDocument();
  });

  it("switches to the Tool tab when a tool with options is picked, and Beautify is still one click away", async () => {
    await mount(ALL);
    fireEvent.click(btn("Box"));
    expect(tab("Tool")).toHaveAttribute("aria-selected", "true");
    expect(toolPanelState()).toBe("stroke");
    expect(within(panel()).getByText("Color")).toBeInTheDocument();
    expect(within(panel()).getByText("Stroke")).toBeInTheDocument();
    fireEvent.click(tab("Beautify"));
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector('[data-ui-area="editorImage.beautify"]')).not.toBeNull();
    // The tool is still the Box tool: only the panel changed.
    expect(isActive("Box")).toBe(true);
  });

  it("switches on the tool's key as well as on its click", async () => {
    await mount(ALL);
    press("p");
    expect(tab("Tool")).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByText("Stroke")).toBeInTheDocument();
  });

  it("picking Select leaves the tab as it was", async () => {
    await mount(ALL);
    press("v");
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
  });

  it("the top bar renders no per-tool options", async () => {
    await mount(ALL);
    for (const name of ["Pen", "Text", "Step", "Redact", "Export frame"]) {
      fireEvent.click(btn(name));
      for (const label of ["Color", "Stroke", "Size", "Style", "Fit to content"]) {
        expect(within(toolbar()).queryByText(label)).toBeNull();
      }
    }
  });

  it.each([
    ["Pen", "Stroke"],
    ["Text", "Size"],
    ["Step", "Size"],
  ])("%s shows %s in the panel, not over the stage", async (tool, label) => {
    await mount(ALL);
    fireEvent.click(btn(tool));
    expect(within(panel()).getByText(label)).toBeInTheDocument();
    const stage = document.querySelector('[data-ui-area="editorImage.canvas"]');
    expect(stage).not.toBeNull();
    expect(within(stage as HTMLElement).queryByText(label)).toBeNull();
  });

  it("Redact shows its Blur / Solid style in the panel", async () => {
    await mount(ALL);
    fireEvent.click(btn("Redact"));
    expect(toolPanelState()).toBe("redact");
    expect(within(panel()).getByRole("button", { name: "Solid" })).toBeInTheDocument();
  });

  it("Export frame shows its card in the panel, not over the stage", async () => {
    await mount(ALL);
    fireEvent.click(btn("Export frame"));
    expect(toolPanelState()).toBe("crop");
    expect(within(panel()).getByRole("button", { name: "Fit to content" })).toBeInTheDocument();
    const card = document.querySelector('[data-ui-area="editorImage.exportFrameCard"]');
    expect(card?.closest('[role="tabpanel"]')).not.toBeNull();
  });

  it("Select text shows its recognition status in the panel (its buttons: the text page tests)", async () => {
    await mount(ALL);
    fireEvent.click(btn("Select text"));
    expect(toolPanelState()).toBe("selectText");
    // jsdom has no recognizer, so the status is the only part that exists here.
    expect(within(panel()).getByRole("status")).toBeInTheDocument();
  });

  it("Inspect shows its controls in the panel, and leaving it returns to Beautify", async () => {
    await mount(ALL);
    fireEvent.click(btn("Inspect (I)"));
    expect(tab("Tool")).toHaveAttribute("aria-selected", "true");
    expect(toolPanelState()).toBe("inspect");
    for (const name of ["Width", "Height", "Outer", "Copy color", "Colors"]) {
      expect(within(panel()).getByText(name)).toBeInTheDocument();
    }
    // Nothing of Inspect is left in the top bar except its mode switch.
    expect(within(toolbar()).queryByRole("button", { name: "Copy color" })).toBeNull();
    press("Escape");
    expect(tab("Beautify")).toHaveAttribute("aria-selected", "true");
  });

  it("Inspect's keys still work with the controls in the panel", async () => {
    await mount(ALL);
    press("i");
    expect(screen.getByRole("tab", { name: "Tool" })).toHaveAttribute("aria-selected", "true");
    press("Escape");
    expect(btn("Annotate (Esc)")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the tab strip with the Tool and Beautify tabs where Inspect does not exist", async () => {
    await mount(["image-canvas"]);
    expect(screen.queryByRole("tab", { name: "Colors" })).toBeNull();
    fireEvent.click(btn("Pen"));
    expect(tab("Tool")).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByText("Stroke")).toBeInTheDocument();
  });

  it("holds the options in the sheet in the compact layout, without opening it", async () => {
    await mount(ALL);
    setPageWidth(900);
    fireEvent.click(btn("Draw"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Box/ }));
    expect(btn("Panel")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn("Panel"));
    expect(tab("Tool")).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByText("Stroke")).toBeInTheDocument();
  });
});
