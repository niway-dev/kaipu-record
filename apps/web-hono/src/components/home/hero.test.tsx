import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadUrls } from "@/lib/download";
import { renderWithProviders } from "@/test/render";
import { AUTO_STEP_MS } from "./hero-modes";

vi.mock("@kaipu/brand", () => ({ KaipuLogo: () => null }));
vi.mock("@/components/download-link", () => ({
  DownloadLink: ({
    children,
    href,
    placement,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { placement: string; href: string }) => (
    <a href={href} data-placement={placement} {...rest}>
      {children}
    </a>
  ),
}));

import { Hero } from "./hero";

/** jsdom has no layout: every box is 1000 × 500 at the origin, so a pointer's x/y map to fractions. */
const BOX = { left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, x: 0, y: 0 };

// jsdom has no PointerEvent: without one, fireEvent builds a plain Event and clientX is lost.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(
    type: string,
    init: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    ...BOX,
    toJSON: () => BOX,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tab = (name: string) => screen.getByRole("button", { name });
const go = (name: string) => fireEvent.click(tab(name));
const heading = () => screen.getByRole("heading", { level: 1 }).textContent;
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed");
const pointer = (
  el: Element,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  x: number,
  y: number,
) => fireEvent[type](el, { clientX: x, clientY: y, pointerId: 1 });
const drag = (el: Element, from: [number, number], to: [number, number]) => {
  pointer(el, "pointerDown", ...from);
  pointer(el, "pointerMove", ...to);
  pointer(el, "pointerUp", ...to);
};
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("Hero overview", () => {
  it("opens on the brand statement with no demo screen", () => {
    renderWithProviders(<Hero />);
    expect(heading()).toBe("From your screen. To the world.");
    expect(pressed(tab("Overview"))).toBe("true");
    expect(screen.queryByRole("group", { name: "Demo screen" })).toBeNull();
  });

  it.each([
    ["Record", "Record it."],
    ["Screenshot", "Snap it."],
    ["Edit", "Edit it."],
    ["Export", "Export it."],
  ])("the %s step changes the title, the pressed state and shows the screen", (name, title) => {
    renderWithProviders(<Hero />);
    go(name);
    expect(heading()).toBe(title);
    expect(pressed(tab(name))).toBe("true");
    expect(pressed(tab("Overview"))).toBe("false");
    expect(screen.getByRole("group", { name: "Demo screen" })).toBeTruthy();
  });

  it("keeps the download links in every step", () => {
    renderWithProviders(<Hero />);
    expect(screen.getAllByRole("link", { name: /Download Kaipu for Mac/ })[0]).toBeTruthy();
    go("Record");
    expect(screen.getAllByRole("link", { name: /Download Kaipu for Mac/ })[0]).toBeTruthy();
  });

  it("renders in Spanish", () => {
    renderWithProviders(<Hero />, "es");
    expect(heading()).toBe("De tu pantalla. Al mundo.");
    go("Grabar");
    expect(screen.getByRole("button", { name: "Pausar" })).toBeTruthy();
  });
});

describe("Record", () => {
  it("runs a timer, pauses, resumes and stops on the visitor's clicks only", () => {
    vi.useFakeTimers();
    renderWithProviders(<Hero />);
    go("Record");
    const timer = () => screen.getByRole("timer").textContent;

    expect(timer()).toBe("00:00");
    tick(3000);
    expect(timer()).toBe("00:03");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(5000);
    expect(timer()).toBe("00:03");

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    tick(2000);
    expect(timer()).toBe("00:05");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    tick(5000);
    expect(screen.getByText("Saved in ~/Movies/Kaipu Record · 00:05")).toBeTruthy();
  });

  it("toggles the microphone and the camera", () => {
    renderWithProviders(<Hero />);
    go("Record");
    const mic = screen.getByRole("button", { name: "Microphone" });
    const cam = screen.getByRole("button", { name: "Camera" });
    expect([pressed(mic), pressed(cam)]).toEqual(["true", "true"]);
    fireEvent.click(mic);
    fireEvent.click(cam);
    expect([pressed(mic), pressed(cam)]).toEqual(["false", "false"]);
  });

  it("starts over, or goes to the editor's video, after stopping", () => {
    vi.useFakeTimers();
    renderWithProviders(<Hero />);
    go("Record");
    tick(2000);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    expect(screen.getByRole("timer").textContent).toBe("00:00");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit it" }));
    expect(pressed(tab("Edit"))).toBe("true");
    expect(pressed(screen.getByRole("button", { name: "Video" }))).toBe("true");
  });
});

describe("Screenshot", () => {
  const region = () => screen.getByTestId("selection-region");

  it("shows an area by default and switches to the full screen", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    expect(region().textContent).toBe("1306 × 605");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(region().textContent).toBe("1920 × 1080");
    expect(screen.queryByText("Drag to choose an area")).toBeNull();
  });

  it("drags a new selection and reports its size", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    drag(screen.getByTestId("selection-surface"), [100, 50], [600, 300]);
    expect(region().textContent).toBe("960 × 540");
    expect(region().style.left).toBe("10%");
    expect(region().style.width).toBe("50%");
  });

  it("does not drag in full-screen mode", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    drag(screen.getByTestId("selection-surface"), [100, 50], [300, 100]);
    expect(region().textContent).toBe("1920 × 1080");
  });

  it("lets touch scroll until Area is explicitly selected, and restores scrolling for Full screen", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    const surface = screen.getByTestId("selection-surface");
    const swipe = () => {
      fireEvent.pointerDown(surface, { pointerType: "touch", clientX: 100, clientY: 50 });
      fireEvent.pointerMove(surface, { pointerType: "touch", clientX: 600, clientY: 300 });
      fireEvent.pointerUp(surface, { pointerType: "touch" });
    };
    swipe();
    expect(region().textContent).toBe("1306 × 605");
    expect(surface.getAttribute("data-touch")).toBe("scroll");
    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    swipe();
    expect(region().textContent).toBe("960 × 540");
    expect(surface.getAttribute("data-touch")).toBe("select");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(surface.getAttribute("data-touch")).toBe("scroll");
  });

  it("Capture opens the image canvas on the selected area", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    drag(screen.getByTestId("selection-surface"), [250, 125], [750, 375]);
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    expect(pressed(tab("Edit"))).toBe("true");
    expect(pressed(screen.getByRole("button", { name: "Image" }))).toBe("true");
    expect(screen.getByText("Saved to Screenshots · 960 × 540")).toBeTruthy();
    const shot = screen.getByTestId("captured-image");
    expect(shot.style.transform).toContain("scale(2)");
    expect(shot.style.clipPath).toBe("inset(25% 25% 25% 25%)");
  });
});

describe("Edit image", () => {
  const open = () => {
    renderWithProviders(<Hero />);
    go("Edit");
  };
  const surface = () => screen.getByTestId("annotation-surface");
  const marks = (kind: string) => surface().querySelectorAll(`[data-mark="${kind}"]`).length;

  it("opens on the whole screen when no capture was taken", () => {
    open();
    expect(screen.getByTestId("captured-image").style.transform).toContain("scale(1)");
    expect(screen.getByText("Saved to Screenshots · 1920 × 1080")).toBeTruthy();
  });

  it("draws with the pencil, the arrow and the text tool", () => {
    open();
    drag(surface(), [100, 100], [300, 200]);
    expect(marks("pencil")).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    drag(surface(), [400, 100], [600, 300]);
    expect(marks("arrow")).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    pointer(surface(), "pointerDown", 500, 250);
    expect(marks("text")).toBe(1);
    expect(within(surface()).getByText("Look here")).toBeTruthy();
  });

  describe("on a touch screen", () => {
    const swipe = (type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number) =>
      fireEvent[type](surface(), { clientX: x, clientY: y, pointerId: 7, pointerType: "touch" });

    it("a swipe on the image scrolls the page instead of drawing", () => {
      open();
      swipe("pointerDown", 100, 100);
      swipe("pointerMove", 100, 300);
      swipe("pointerUp", 100, 300);
      expect(marks("pencil")).toBe(0);
      expect(surface().getAttribute("data-touch")).toBe("scroll");
    });

    it("draws once the visitor picks a tool", () => {
      open();
      fireEvent.click(screen.getByRole("button", { name: "Pencil" }));
      expect(surface().getAttribute("data-touch")).toBe("draw");
      swipe("pointerDown", 100, 100);
      swipe("pointerMove", 300, 300);
      swipe("pointerUp", 300, 300);
      expect(marks("pencil")).toBe(1);
    });

    it("a mouse still draws with the default pencil", () => {
      open();
      drag(surface(), [100, 100], [300, 200]);
      expect(marks("pencil")).toBe(1);
    });
  });

  it("ignores an arrow that was only a click", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    drag(surface(), [400, 100], [401, 101]);
    expect(marks("arrow")).toBe(0);
  });

  it("undoes the last mark and resets them all, and disables both when empty", () => {
    open();
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    const reset = screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    expect([undo.disabled, reset.disabled]).toEqual([true, true]);

    drag(surface(), [100, 100], [300, 200]);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    pointer(surface(), "pointerDown", 500, 250);
    expect([marks("pencil"), marks("text")]).toEqual([1, 1]);

    fireEvent.click(undo);
    expect([marks("pencil"), marks("text")]).toEqual([1, 0]);
    fireEvent.click(reset);
    expect([marks("pencil"), marks("text")]).toEqual([0, 0]);
    expect(undo.disabled).toBe(true);
  });
});

describe("Edit video", () => {
  const open = () => {
    renderWithProviders(<Hero />);
    go("Edit");
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
  };
  const range = (name: string) => screen.getByRole("slider", { name }) as HTMLInputElement;
  const status = () => screen.getByTestId("trim-status").textContent;

  it("shows the timeline below the same page, with the starting trim", () => {
    open();
    expect(status()).toContain("Trim 00:02 → 00:26");
    expect(status()).toContain("00:24 kept");
    expect(screen.getByTestId("timecode").textContent).toBe("00:09");
  });

  it("moving the trim handles changes the status", () => {
    open();
    fireEvent.change(range("Trim start"), { target: { value: "6" } });
    fireEvent.change(range("Trim end"), { target: { value: "20" } });
    expect(status()).toContain("Trim 00:06 → 00:20");
    expect(status()).toContain("00:14 kept");
  });

  it("moving the playhead changes the timecode, and trimming keeps it inside", () => {
    open();
    fireEvent.change(range("Playhead"), { target: { value: "15" } });
    expect(screen.getByTestId("timecode").textContent).toBe("00:15");
    fireEvent.change(range("Trim end"), { target: { value: "12" } });
    expect(screen.getByTestId("timecode").textContent).toBe("00:12");
    expect(range("Playhead").value).toBe("12");
  });

  it("plays from the playhead and stops at the end of the trim", () => {
    vi.useFakeTimers();
    open();
    fireEvent.change(range("Playhead"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    tick(1000);
    expect(screen.getByTestId("timecode").textContent).toBe("00:25");
    tick(3000);
    expect(screen.getByTestId("timecode").textContent).toBe("00:26");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("goes back to the image canvas and keeps the marks", () => {
    renderWithProviders(<Hero />);
    go("Edit");
    drag(screen.getByTestId("annotation-surface"), [100, 100], [300, 200]);
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    expect(
      screen.getByTestId("annotation-surface").querySelectorAll('[data-mark="pencil"]'),
    ).toHaveLength(1);
  });
});

describe("Export", () => {
  const open = () => {
    renderWithProviders(<Hero />);
    go("Export");
  };
  const choose = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
  const summary = () => screen.getByTestId("export-summary").textContent;

  it("anchors a panel over the same page, opening on YouTube with the trimmed length and a size", () => {
    open();
    expect(screen.getByText("kaipu-demo.mp4")).toBeTruthy();
    expect(
      pressed(
        within(screen.getByRole("group", { name: "Destination" })).getByRole("button", {
          name: "YouTube",
        }),
      ),
    ).toBe("true");
    expect(summary()).toBe("MP4 · 2560 × 1440");
    expect(screen.getByText("00:24 · 48 MB")).toBeTruthy();
    const anchor = screen.getByRole("button", { name: /YouTube/, expanded: true });
    fireEvent.click(anchor);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Destination" })).toBeNull();
  });

  it("uses the trim set in Edit", () => {
    renderWithProviders(<Hero />);
    go("Edit");
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.change(screen.getByRole("slider", { name: "Trim end" }), { target: { value: "12" } });
    go("Export");
    expect(screen.getByText(/^00:10 · /)).toBeTruthy();
  });

  it("offers the app's own destinations, in the app's order, then Custom", () => {
    open();
    const names = within(screen.getByRole("group", { name: "Destination" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual([
      "YouTube",
      "Reels · TikTok · Shorts",
      "LinkedIn · Feeds",
      "GitHub · Jira · Linear",
      "Slack · Discord · Email",
      "Archive copy",
      "Custom",
    ]);
  });

  it.each([
    ["Reels · TikTok · Shorts", "MP4 · 1080 × 1920", "00:24 · 24 MB"],
    ["LinkedIn · Feeds", "MP4 · 1080 × 1080", "00:24 · 14 MB"],
    ["GitHub · Jira · Linear", "MP4 · 1920 × 1080 · up to 24 fps", "00:24 · 1.9 MB"],
    ["Slack · Discord · Email", "MP4 · 1920 × 1080 · up to 24 fps", "00:24 · 2.4 MB"],
    ["Archive copy", "MP4 · recording’s own size", "00:24 · recording’s own size"],
  ])("%s prepares an MP4 with its own picture and size", (name, facts, foot) => {
    open();
    choose(name);
    expect(summary()).toBe(facts);
    expect(screen.getByText(foot)).toBeTruthy();
    expect(screen.getByText("kaipu-demo.mp4")).toBeTruthy();
  });

  it("YouTube keeps a 1440p / 4K choice that changes the picture and the size", () => {
    open();
    choose("4K");
    expect(summary()).toBe("MP4 · 3840 × 2160");
    expect(screen.getByText("00:24 · 135 MB")).toBeTruthy();
    choose("1440p");
    expect(summary()).toBe("MP4 · 2560 × 1440");
  });

  it("GitHub says whether the copy fits the free plan's 10 MB, and nothing else about limits", () => {
    open();
    choose("GitHub · Jira · Linear");
    expect(screen.getByText("Fits GitHub Free (10 MB)")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Resolution" })).toBeNull();
  });

  it("Custom is the free panel: any of MP4, GIF and PNG with a resolution", () => {
    open();
    choose("Custom");
    choose("4K");
    expect(screen.getByText("00:24 · 12 MB")).toBeTruthy();
    choose("PNG");
    expect(screen.getByText("1.6 MB")).toBeTruthy();
    expect(screen.getByText("kaipu-demo.png")).toBeTruthy();
    choose("GIF");
    expect(screen.getByText("kaipu-demo.gif")).toBeTruthy();
  });

  it("simulates the export: progress, then what to do next, with no upload action", () => {
    vi.useFakeTimers();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    expect(screen.getByText("Exporting… 0%")).toBeTruthy();
    tick(140 * 4);
    expect(screen.getByText(/Exporting… 4[0-9]%/)).toBeTruthy();
    tick(140 * 6);

    expect(screen.getByText("Export complete")).toBeTruthy();
    expect(screen.getByText("kaipu-demo.mp4 · 48 MB")).toBeTruthy();
    expect(screen.getByText("Upload it in YouTube Studio.")).toBeTruthy();
    expect(screen.getByText("Kaipu makes the file; you upload it yourself.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /upload/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Export again" }));
    expect(screen.getByRole("button", { name: "Export file" })).toBeTruthy();
  });

  it("cannot be closed from the format button while it exports or shows its result", () => {
    vi.useFakeTimers();
    open();
    const anchor = () =>
      document.querySelector<HTMLElement>("[aria-controls='kl-stage-export-panel']")!;
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(140);
    expect(anchor().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(anchor());
    expect(screen.getByText(/Exporting… \d+%/)).toBeTruthy();

    tick(2000);
    expect(screen.getByText("Export complete")).toBeTruthy();
    fireEvent.click(anchor());
    expect(screen.getByText("Export complete")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Export again" }));
    expect(anchor().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(anchor());
    expect(screen.queryByRole("button", { name: "Export file" })).toBeNull();
    expect(anchor().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the progress bar as part of the footer that stays in view", () => {
    vi.useFakeTimers();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(140);
    const bar = screen.getByTestId("export-progress");
    expect(bar.closest("[data-testid='export-footer']")).not.toBeNull();
    expect(bar.firstElementChild).toHaveProperty("style.width", "12%");
  });

  it.each([
    ["GitHub · Jira · Linear", "Drag it into a GitHub comment, or a Jira or Linear ticket."],
    ["Slack · Discord · Email", "Drop it into a chat, or attach it to an email."],
    ["Archive copy", "Keep it as a full-quality copy outside Kaipu."],
  ])("%s ends with its own next step", (name, next) => {
    vi.useFakeTimers();
    open();
    choose(name);
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(2000);
    expect(screen.getByText(next)).toBeTruthy();
  });

  it("choosing another destination after an export starts a fresh one", () => {
    vi.useFakeTimers();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(2000);
    expect(screen.getByText("Export complete")).toBeTruthy();
    choose("Reels · TikTok · Shorts");
    expect(screen.queryByText("Export complete")).toBeNull();
    expect(screen.getByRole("button", { name: "Export file" })).toBeTruthy();
  });
});

describe("Highlighter", () => {
  it("puts the swash on the last word of the headline and keeps the sentence whole", () => {
    renderWithProviders(<Hero />);
    const marks = screen.getByRole("heading", { level: 1 }).querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("world");
    expect(heading()).toBe("From your screen. To the world.");
  });

  it("moves with the language instead of splitting an English sentence", () => {
    renderWithProviders(<Hero />, "es");
    const marks = screen.getByRole("heading", { level: 1 }).querySelectorAll("mark");
    expect(marks[0]!.textContent).toBe("mundo");
    expect(heading()).toBe("De tu pantalla. Al mundo.");
  });

  it("is the same on the sample screen every step films, captures and exports", () => {
    renderWithProviders(<Hero />);
    for (const name of ["Record", "Screenshot", "Edit", "Export"]) {
      go(name);
      const stage = screen.getByRole("group", { name: "Demo screen" });
      expect(stage.querySelector("mark")?.textContent).toBe("world");
      expect(screen.getByRole("heading", { level: 1 }).querySelector("mark")).toBeNull();
    }
  });
});

describe("Workspaces", () => {
  const folder = () => screen.getByTestId("workspace-folder").textContent;
  const switchTo = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Workspace" })).getByRole("button", {
        name: new RegExp(name),
      }),
    );
  };

  it("has no bar on the overview and one on every step", () => {
    renderWithProviders(<Hero />);
    expect(screen.queryByTestId("workspace-bar")).toBeNull();
    for (const name of ["Record", "Screenshot", "Edit", "Export"]) {
      go(name);
      expect(screen.getByTestId("workspace-bar")).toBeTruthy();
      expect(folder()).toBe("~/Movies/Kaipu Record");
    }
  });

  it("switching changes the folder, and the choice follows the visitor to every step", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    switchTo("Work");
    expect(folder()).toBe("~/Movies/Kaipu Record — Work");
    for (const name of ["Record", "Edit", "Export"]) {
      go(name);
      expect(folder()).toBe("~/Movies/Kaipu Record — Work");
    }
    expect(screen.getByRole("button", { name: "Switch workspace: Work" })).toBeTruthy();
  });

  it("lists each workspace with its own folder", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    fireEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    const menu = screen.getByRole("group", { name: "Workspace" });
    expect(within(menu).getByText("~/Movies/Kaipu Record")).toBeTruthy();
    expect(within(menu).getByText("~/Movies/Kaipu Record — Work")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Workspace" })).toBeNull();
  });

  it("saves a recording and an export in the active workspace's folder", () => {
    vi.useFakeTimers();
    renderWithProviders(<Hero />);
    go("Screenshot");
    switchTo("Work");
    go("Record");
    tick(2000);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Saved in ~/Movies/Kaipu Record — Work · 00:02")).toBeTruthy();

    go("Export");
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(2000);
    expect(screen.getByTestId("export-folder").textContent).toBe(
      "Added to Work · ~/Movies/Kaipu Record — Work",
    );
  });

  it("keeps a completed export in its original workspace after switching folders", () => {
    vi.useFakeTimers();
    renderWithProviders(<Hero />);
    go("Export");
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(2000);
    const saved = "Added to Personal · ~/Movies/Kaipu Record";
    expect(screen.getByTestId("export-folder").textContent).toBe(saved);

    switchTo("Work");
    expect(folder()).toBe("~/Movies/Kaipu Record — Work");
    expect(screen.getByTestId("export-folder").textContent).toBe(saved);

    fireEvent.click(screen.getByRole("button", { name: "Export again" }));
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(2000);
    expect(screen.getByTestId("export-folder").textContent).toBe(
      "Added to Work · ~/Movies/Kaipu Record — Work",
    );
  });

  it("keeps a saved take where it was written when the workspace changes afterwards", () => {
    vi.useFakeTimers();
    renderWithProviders(<Hero />);
    go("Record");
    tick(2000);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Saved in ~/Movies/Kaipu Record · 00:02")).toBeTruthy();

    switchTo("Work");
    expect(folder()).toBe("~/Movies/Kaipu Record — Work");
    expect(screen.getByText("Saved in ~/Movies/Kaipu Record · 00:02")).toBeTruthy();
    expect(screen.queryByText(/Saved in ~\/Movies\/Kaipu Record — Work/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    tick(1000);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Saved in ~/Movies/Kaipu Record — Work · 00:01")).toBeTruthy();
  });

  it("will not switch while recording or exporting, like the app", () => {
    vi.useFakeTimers();
    renderWithProviders(<Hero />);
    go("Record");
    fireEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    const menu = () => screen.getByRole("group", { name: "Workspace" });
    expect(within(menu()).getByRole("button", { name: /Work/ })).toHaveProperty("disabled", true);
    expect(within(menu()).getByText("Finish the recording to switch")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    expect(within(menu()).getByRole("button", { name: /Work/ })).toHaveProperty("disabled", false);
    fireEvent.keyDown(document, { key: "Escape" });

    go("Export");
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    tick(140);
    fireEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    expect(within(menu()).getByRole("button", { name: /Work/ })).toHaveProperty("disabled", true);
    expect(within(menu()).getByText("Wait for the export to finish to switch")).toBeTruthy();
  });

  it("names the workspace and its folder in Spanish the way the app does", () => {
    renderWithProviders(<Hero />, "es");
    go("Captura");
    fireEvent.click(screen.getByRole("button", { name: /Cambiar de espacio de trabajo/ }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Espacio de trabajo" })).getByRole("button", {
        name: /Trabajo/,
      }),
    );
    expect(folder()).toBe("~/Movies/Kaipu Record — Trabajo");
  });
});

describe("Auto demo", () => {
  const status = () => screen.getByTestId("auto-status").textContent;
  const step = () => HERO_LABELS.find((n) => pressed(tab(n)) === "true");
  const HERO_LABELS = ["Overview", "Record", "Screenshot", "Edit", "Export"];
  const run = (ms: number) => tick(ms);
  const start = (locale: "en" | "es" = "en") => {
    vi.useFakeTimers();
    return renderWithProviders(<Hero />, locale);
  };

  it("counts down on the overview and says what comes next", () => {
    start();
    expect(status()).toBe("Next: Record in 10s");
    run(3000);
    expect(status()).toBe("Next: Record in 7s");
    expect(step()).toBe("Overview");
  });

  it("plays Overview, Record, Screenshot, Edit and Export, then back to the Overview", () => {
    start();
    const seen: (string | undefined)[] = [step()];
    for (let i = 0; i < 5; i++) {
      run(AUTO_STEP_MS);
      seen.push(step());
    }
    expect(seen).toEqual(["Overview", "Record", "Screenshot", "Edit", "Export", "Overview"]);
  });

  it("keeps going round, a step every ten seconds", () => {
    start();
    for (let i = 0; i < 7; i++) run(AUTO_STEP_MS);
    expect(step()).toBe("Screenshot");
  });

  it("pauses and resumes with its button, and says so", () => {
    start();
    run(4000);
    fireEvent.click(screen.getByRole("button", { name: "Pause the auto demo" }));
    expect(status()).toBe("Auto demo paused");
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Overview");
    const play = screen.getByRole("button", { name: "Play the auto demo" });
    expect(play.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(play);
    run(AUTO_STEP_MS);
    expect(step()).toBe("Record");
  });

  it("plays while its play button retains keyboard focus", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Pause the auto demo" }));
    const play = screen.getByRole("button", { name: "Play the auto demo" });
    act(() => play.focus());
    fireEvent.click(play);
    expect(status()).toBe("Next: Record in 10s");
    run(AUTO_STEP_MS);
    expect(step()).toBe("Record");
  });

  it("a step picked by hand wins and starts a full interval", () => {
    start();
    run(8000);
    go("Screenshot");
    expect(step()).toBe("Screenshot");
    expect(status()).toBe("Next: Edit in 10s");
    run(9000);
    expect(step()).toBe("Screenshot");
    run(1000);
    expect(step()).toBe("Edit");
  });

  it("picking the step you are already on also starts over", () => {
    start();
    run(8000);
    go("Overview");
    run(8000);
    expect(step()).toBe("Overview");
  });

  it("waits while the pointer is down on the screen, then gives a whole interval", () => {
    start();
    go("Screenshot");
    const stage = screen.getByRole("group", { name: "Demo screen" });
    pointer(stage, "pointerDown", 10, 10);
    expect(status()).toBe("On hold while you use the demo");
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Screenshot");
    pointer(stage, "pointerUp", 10, 10);
    run(AUTO_STEP_MS - 100);
    expect(step()).toBe("Screenshot");
    run(100);
    expect(step()).toBe("Edit");
  });

  it("waits while a mouse hovers the screen", () => {
    start();
    go("Record");
    const stage = screen.getByRole("group", { name: "Demo screen" });
    fireEvent.pointerEnter(stage, { pointerType: "mouse" });
    run(AUTO_STEP_MS * 2);
    expect(step()).toBe("Record");
    fireEvent.pointerLeave(stage);
    run(AUTO_STEP_MS);
    expect(step()).toBe("Screenshot");
  });

  it("does not freeze on a touch, only while the finger is down", () => {
    start();
    go("Record");
    const stage = screen.getByRole("group", { name: "Demo screen" });
    fireEvent.pointerEnter(stage, { pointerType: "touch" });
    run(AUTO_STEP_MS);
    expect(step()).toBe("Screenshot");
  });

  it("waits for keyboard focus inside the screen", () => {
    start();
    go("Record");
    const mic = screen.getByRole("button", { name: "Microphone" });
    act(() => mic.focus());
    run(AUTO_STEP_MS * 2);
    expect(step()).toBe("Record");
    act(() => mic.blur());
    run(AUTO_STEP_MS);
    expect(step()).toBe("Screenshot");
  });

  it("moves on after a keyboard Capture, whose focused button the capture removes", () => {
    start();
    go("Screenshot");
    const capture = screen.getByRole("button", { name: "Capture" });
    act(() => capture.focus());
    expect(status()).toBe("On hold while you use the demo");
    fireEvent.click(capture);
    expect(step()).toBe("Edit");
    expect(screen.queryByRole("button", { name: "Capture" })).toBeNull();
    run(AUTO_STEP_MS);
    expect(step()).toBe("Export");
  });

  it("moves on after the screen a mouse rested on is replaced by the Overview", () => {
    start();
    go("Record");
    const stage = screen.getByRole("group", { name: "Demo screen" });
    fireEvent.pointerEnter(stage, { pointerType: "mouse" });
    const overview = tab("Overview");
    act(() => overview.focus());
    fireEvent.click(overview);
    expect(step()).toBe("Overview");
    expect(screen.queryByRole("group", { name: "Demo screen" })).toBeNull();
    act(() => overview.blur());
    run(AUTO_STEP_MS);
    expect(step()).toBe("Record");
  });

  it("keeps waiting while a mouse still rests on a screen that changed step", () => {
    start();
    go("Screenshot");
    const stage = screen.getByRole("group", { name: "Demo screen" });
    fireEvent.pointerEnter(stage, { pointerType: "mouse" });
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    expect(step()).toBe("Edit");
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Edit");
    fireEvent.pointerLeave(screen.getByRole("group", { name: "Demo screen" }));
    run(AUTO_STEP_MS);
    expect(step()).toBe("Export");
  });

  it("keeps waiting on work after a mode change that clears the pointer holds", () => {
    start();
    go("Record");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit it" }));
    expect(step()).toBe("Edit");
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.change(screen.getByRole("slider", { name: "Trim end" }), { target: { value: "20" } });
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Edit");
  });

  it("does not pull a recording away that is paused or stopped", () => {
    start();
    go("Record");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Record");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    run(AUTO_STEP_MS);
    expect(step()).toBe("Screenshot");
  });

  it("keeps a chosen selection, then moves on once it is the default again", () => {
    start();
    go("Screenshot");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Screenshot");
    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    run(AUTO_STEP_MS);
    expect(step()).toBe("Edit");
  });

  it("does not take the canvas away from marks, and moves on after the last is undone", () => {
    start();
    go("Edit");
    const surface = screen.getByTestId("annotation-surface");
    drag(surface, [100, 100], [400, 300]);
    expect(surface.querySelectorAll('[data-mark="pencil"]')).toHaveLength(1);
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Edit");
    expect(surface.querySelectorAll('[data-mark="pencil"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    run(AUTO_STEP_MS);
    expect(step()).toBe("Export");
  });

  it("does not take the timeline away while a trim is set or the clip plays", () => {
    start();
    go("Edit");
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.change(screen.getByRole("slider", { name: "Trim end" }), { target: { value: "20" } });
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Edit");
    expect(screen.getByRole("slider", { name: "Trim end" })).toHaveProperty("value", "20");
  });

  it("holds through an export and its result, and moves on after Export again", () => {
    start();
    go("Export");
    fireEvent.click(screen.getByRole("button", { name: "Export file" }));
    run(AUTO_STEP_MS * 3);
    expect(screen.getByText("Export complete")).toBeTruthy();
    expect(step()).toBe("Export");
    fireEvent.click(screen.getByRole("button", { name: "Export again" }));
    run(AUTO_STEP_MS);
    expect(step()).toBe("Overview");
  });

  it("holds while the workspace menu is open", () => {
    start();
    go("Screenshot");
    fireEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Screenshot");
    fireEvent.keyDown(document, { key: "Escape" });
    run(AUTO_STEP_MS);
    expect(step()).toBe("Edit");
  });

  it("pauses while the tab is hidden and resumes when it is back", () => {
    start();
    run(3000);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(status()).toBe("On hold while out of view");
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Overview");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    run(7000);
    expect(step()).toBe("Record");
  });

  it("pauses while the hero is scrolled out of view", () => {
    let report: ((entries: Partial<IntersectionObserverEntry>[]) => void) | undefined;
    class FakeObserver {
      constructor(cb: typeof report) {
        report = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    start();
    act(() => report?.([{ intersectionRatio: 0 }]));
    expect(status()).toBe("On hold while out of view");
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Overview");
    act(() => report?.([{ intersectionRatio: 1 }]));
    run(AUTO_STEP_MS);
    expect(step()).toBe("Record");
  });

  it("starts paused with reduced motion, and the visitor can still play it", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    start();
    expect(status()).toBe("Auto demo paused");
    run(AUTO_STEP_MS * 3);
    expect(step()).toBe("Overview");
    fireEvent.click(screen.getByRole("button", { name: "Play the auto demo" }));
    run(AUTO_STEP_MS);
    expect(step()).toBe("Record");
  });

  it("leaves no timer behind when it unmounts", () => {
    const { unmount } = start();
    run(3000);
    go("Record");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => run(AUTO_STEP_MS * 3)).not.toThrow();
  });

  it("reads in Spanish", () => {
    start("es");
    expect(status()).toBe("Siguiente: Grabar en 10 s");
    fireEvent.click(screen.getByRole("button", { name: "Pausar la demo automática" }));
    expect(status()).toBe("Demo automática en pausa");
  });
});

describe("Download button inside the demo screen", () => {
  const links = (placement: string) =>
    screen
      .queryAllByRole("link", { name: /Download Kaipu for Mac/ })
      .filter((a) => a.getAttribute("data-placement") === placement);
  const demoLink = () => links("hero-demo")[0]!;
  const outerLinks = () => links("hero");

  it("is a real installer link in Record, opening a new tab so the demo stays", () => {
    renderWithProviders(<Hero />);
    go("Record");
    const link = demoLink();
    expect(link.getAttribute("href")).toBe(downloadUrls.macArm64);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("data-placement")).toBe("hero-demo");
    // An interactive element must never sit inside aria-hidden.
    expect(link.closest("[aria-hidden='true']")).toBeNull();
  });

  it("keeps the recording controls working next to it", () => {
    renderWithProviders(<Hero />);
    go("Record");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(demoLink().getAttribute("href")).toBe(downloadUrls.macArm64);
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("is not a link where the Screenshot selection or the Edit canvas own the pointer", () => {
    renderWithProviders(<Hero />);
    go("Screenshot");
    expect(links("hero-demo")).toHaveLength(0);
    const surface = screen.getByTestId("selection-surface");
    drag(surface, [100, 100], [400, 300]);
    expect(screen.getByTestId("selection-region")).toBeTruthy();
    go("Edit");
    expect(links("hero-demo")).toHaveLength(0);
    expect(screen.getByTestId("annotation-surface")).toBeTruthy();
  });

  it("pairs the installer link with an in-page link for phones, so a phone never downloads a .dmg", () => {
    renderWithProviders(<Hero />);
    go("Record");
    const pair = within(screen.getByRole("group", { name: "Demo screen" })).getAllByRole("link", {
      name: /Download Kaipu for Mac/,
    });
    const hrefs = pair.map((a) => a.getAttribute("href")).sort();
    expect(hrefs).toEqual(["#download", downloadUrls.macArm64].sort());
    const phone = pair.find((a) => a.getAttribute("href") === "#download")!;
    expect(phone.getAttribute("target")).toBeNull();
    expect(phone.getAttribute("data-placement")).toBeNull();
    expect(phone.closest("[aria-hidden='true']")).toBeNull();
    expect(links("hero-demo")).toHaveLength(1);
  });

  it("leaves the outer downloads exactly as they were", () => {
    renderWithProviders(<Hero />);
    go("Record");
    const outer = outerLinks();
    expect(outer.map((a) => a.getAttribute("href"))).toContain(downloadUrls.macArm64);
    for (const a of outer) {
      expect(a.getAttribute("target")).toBeNull();
    }
  });
});
