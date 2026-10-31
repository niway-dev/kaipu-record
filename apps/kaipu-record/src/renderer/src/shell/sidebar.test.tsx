import { act, cleanup, render, screen } from "@testing-library/react";
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
      { path: ROUTES.screenshots, element: <Sidebar /> },
      { path: ROUTES.library, element: <Sidebar /> },
      { path: ROUTES.libraryDetail, element: <Sidebar /> },
      { path: ROUTES.exportNew, element: <Sidebar /> },
      { path: ROUTES.export, element: <Sidebar /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const exportLink = (): HTMLElement => screen.getByRole("link", { name: /^Export/ });

afterEach(() => {
  __resetReadyCopiesForTests();
  runnerStatus.set("idle");
});

describe("Sidebar Export entry and badge", () => {
  it("sits right under Editor", () => {
    renderAt("/");
    const labels = screen.getAllByRole("link").map((link) => link.textContent);
    expect(labels.indexOf("Export")).toBe(labels.indexOf("Editor") + 1);
  });

  it("is active on Export with and without a video", () => {
    renderAt("/export/asset-1");
    expect(exportLink()).toHaveAttribute("aria-current", "page");
    cleanup();
    renderAt(ROUTES.exportNew);
    expect(exportLink()).toHaveAttribute("aria-current", "page");
  });

  it("counts an export that is encoding, on top of the finished copies", () => {
    renderAt("/");
    act(() => runnerStatus.set("exporting"));
    expect(exportLink()).toHaveAccessibleName(/1 copy in progress or ready/);
    expect(exportLink()).toHaveTextContent("1");
    act(() => noteFinishedCopy("copy-1"));
    expect(exportLink()).toHaveTextContent("2");
  });

  it("counts copies that finished out of sight, and clears when Export opens", async () => {
    const router = renderAt("/");
    expect(exportLink()).toHaveTextContent(/^Export$/);
    act(() => noteFinishedCopy("copy-1"));
    expect(exportLink()).toHaveAccessibleName(/1 copy in progress or ready/);
    expect(exportLink()).toHaveTextContent("1");
    // The Library no longer carries it.
    expect(screen.getByRole("link", { name: /^Library/ })).toHaveTextContent(/^Library$/);

    await act(() => router.navigate(ROUTES.exportNew));
    expect(exportLink()).toHaveTextContent(/^Export$/);
    // Still pointed at in the Library until the copy itself is opened.
    expect(getReadyCopies().copies).toEqual([{ assetId: "copy-1", announced: true, card: true }]);
  });

  it("opening the Library clears it too, since the Library points at the copies", async () => {
    const router = renderAt("/");
    act(() => noteFinishedCopy("copy-1"));
    await act(() => router.navigate(ROUTES.library));
    expect(exportLink()).toHaveTextContent(/^Export$/);
  });

  it("a copy that finishes while Export is open never badges", () => {
    renderAt(ROUTES.exportNew);
    act(() => noteFinishedCopy("copy-1"));
    expect(exportLink()).toHaveTextContent(/^Export$/);
  });

  it("leaving the Library retires its Ready to upload cards, not the copies", async () => {
    const router = renderAt(ROUTES.library);
    act(() => noteFinishedCopy("copy-1"));
    expect(getReadyCopies().copies[0]).toMatchObject({ card: true });
    // The Library page had the card on screen.
    act(() => noteReadyCardsShown(["copy-1"]));
    await act(() => router.navigate(ROUTES.screenshots));
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
    expect(exportLink()).toHaveAccessibleName(/2 copies in progress or ready/);
    await act(() => router.navigate("/library/copy-1"));
    expect(getReadyCopies().copies.map((c) => c.assetId)).toEqual(["copy-2"]);
  });
});
