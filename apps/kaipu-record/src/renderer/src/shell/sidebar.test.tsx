import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "@shared/routes";
import {
  __resetReadyCopiesForTests,
  getReadyCopies,
  noteFinishedCopy,
  noteReadyCardsShown,
} from "@renderer/features/video-editor/export/ready-copies";
import { Sidebar } from "./sidebar";

/** The runner's status, set by a test as if an export were encoding. */
const runnerStatus = vi.hoisted(() => {
  let value: "idle" | "exporting" = "idle";
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: "idle" | "exporting") {
      value = next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});
vi.mock("@renderer/features/video-editor/export/export-runner", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@renderer/features/video-editor/export/export-runner")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...real,
    useExportRunner: () => {
      const snapshot = real.useExportRunner();
      const status = useSyncExternalStore(runnerStatus.subscribe, runnerStatus.get);
      return status === "exporting" ? { ...snapshot, status } : snapshot;
    },
  };
});

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <Sidebar /> },
      { path: ROUTES.library, element: <Sidebar /> },
      { path: ROUTES.libraryDetail, element: <Sidebar /> },
      { path: ROUTES.exportNew, element: <Sidebar /> },
      { path: ROUTES.export, element: <Sidebar /> },
      // Every other page renders the same shell sidebar.
      { path: "*", element: <Sidebar /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const libraryLink = (): HTMLElement => screen.getByRole("link", { name: /^Library/ });

afterEach(() => {
  __resetReadyCopiesForTests();
  runnerStatus.set("idle");
});

describe("Sidebar items", () => {
  it("lists Capture first and Export between Editor and Library", () => {
    renderAt("/");
    const labels = screen.getAllByRole("link").map((link) => link.textContent);
    expect(labels.slice(0, 7)).toEqual([
      "Capture",
      "Editor",
      "Export",
      "Library",
      "Shortcuts",
      "Settings",
      "Cloud",
    ]);
  });

  it("lights Export on the picker and on a recording's Export page", () => {
    for (const path of [ROUTES.exportNew, "/export/asset-1"]) {
      renderAt(path);
      const current = screen
        .getAllByRole("link")
        .filter((l) => l.getAttribute("aria-current") === "page");
      expect(current.map((l) => l.textContent)).toEqual(["Export"]);
      cleanup();
    }
  });
});

describe("Sidebar active item", () => {
  // The rail computes `active` itself now (no NavLink), so every route must
  // light exactly the one item it belongs to.
  it.each([
    ["/", "Capture"],
    ["/editor", "Editor"],
    ["/editor/video/asset-1", "Editor"],
    ["/editor/image/asset-1", "Editor"],
    ["/library", "Library"],
    ["/library/asset-1", "Library"],
    ["/shortcuts", "Shortcuts"],
    ["/settings", "Settings"],
  ])("%s lights only %s", (path, label) => {
    renderAt(path);
    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page")
      .map((l) => l.textContent);
    expect(current).toEqual([label]);
  });

  it("/cloud lights Cloud and the account avatar, which opens the same page", () => {
    renderAt("/cloud");
    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["Cloud", ""]);
  });
});

describe("Sidebar Library badge (copies being made or ready)", () => {
  it("counts an export that is encoding, on top of the finished copies", () => {
    renderAt("/");
    act(() => runnerStatus.set("exporting"));
    expect(libraryLink()).toHaveAccessibleName(/1 copy in progress or ready/);
    expect(libraryLink()).toHaveTextContent("1");
    act(() => noteFinishedCopy("copy-1"));
    expect(libraryLink()).toHaveTextContent("2");
  });

  it("counts copies that finished out of sight, and clears when the Library opens", async () => {
    const router = renderAt("/");
    expect(libraryLink()).toHaveTextContent(/^Library$/);
    act(() => noteFinishedCopy("copy-1"));
    expect(libraryLink()).toHaveAccessibleName(/1 copy in progress or ready/);
    expect(libraryLink()).toHaveTextContent("1");

    await act(() => router.navigate(ROUTES.library));
    expect(libraryLink()).toHaveTextContent(/^Library$/);
    // Still pointed at in the Library until the copy itself is opened.
    expect(getReadyCopies().copies).toEqual([{ assetId: "copy-1", announced: true, card: true }]);
  });

  it("opening Export clears it too, since Export points at the copies", async () => {
    const router = renderAt("/");
    act(() => noteFinishedCopy("copy-1"));
    await act(() => router.navigate(ROUTES.exportNew));
    expect(libraryLink()).toHaveTextContent(/^Library$/);
  });

  it("a copy that finishes while the Library is open never badges", () => {
    renderAt(ROUTES.library);
    act(() => noteFinishedCopy("copy-1"));
    expect(libraryLink()).toHaveTextContent(/^Library$/);
  });

  it("leaving the Library retires its Ready to upload cards, not the copies", async () => {
    const router = renderAt(ROUTES.library);
    act(() => noteFinishedCopy("copy-1"));
    expect(getReadyCopies().copies[0]).toMatchObject({ card: true });
    // The Library page had the card on screen.
    act(() => noteReadyCardsShown(["copy-1"]));
    await act(() => router.navigate(ROUTES.shortcuts));
    expect(getReadyCopies().copies).toEqual([
      { assetId: "copy-1", announced: true, card: false, shown: true },
    ]);
    // A copy that finishes while away still gets its card on the next visit.
    act(() => noteFinishedCopy("copy-2"));
    await act(() => router.navigate(ROUTES.library));
    expect(getReadyCopies().copies.map((c) => [c.assetId, c.card])).toEqual([
      ["copy-1", false],
      ["copy-2", true],
    ]);
  });

  it("opening the copy's page forgets it", async () => {
    const router = renderAt("/");
    act(() => noteFinishedCopy("copy-1"));
    act(() => noteFinishedCopy("copy-2"));
    expect(libraryLink()).toHaveAccessibleName(/2 copies in progress or ready/);
    await act(() => router.navigate("/library/copy-1"));
    expect(getReadyCopies().copies.map((c) => c.assetId)).toEqual(["copy-2"]);
  });
});

describe("Sidebar is icon-only (NIW2-626)", () => {
  const tip = (): HTMLElement | null => document.querySelector("[data-rail-tooltip]");

  // The keyboard-focus test spies on Element.prototype.matches; never leak it into other tests.
  afterEach(() => vi.restoreAllMocks());

  it("always draws the collapsed rail, with no way to expand it", () => {
    renderAt("/");
    expect(screen.getByRole("navigation")).toHaveAttribute("data-mode", "collapsed");
    expect(screen.queryByRole("button", { name: /sidebar/i })).toBeNull();
  });

  it("names every icon by its label and marks the current page", () => {
    renderAt("/library");
    const library = screen.getByRole("link", { name: "Library" });
    expect(library).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Capture" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "Record" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Screenshot" })).toBeNull();
  });

  it("shows the label in a tooltip on keyboard focus and on hover", () => {
    renderAt("/");
    const settings = screen.getByRole("link", { name: "Settings" });
    // jsdom has no focus heuristics; make `:focus-visible` what a real Tab press gives.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector) {
      return selector === ":focus-visible"
        ? this === document.activeElement
        : matches.call(this, selector);
    });
    act(() => settings.focus());
    expect(tip()).toHaveTextContent("Settings");
    act(() => settings.blur());
    expect(tip()).toBeNull();
    fireEvent.mouseEnter(settings);
    expect(tip()).toHaveTextContent("Settings");
  });
});
