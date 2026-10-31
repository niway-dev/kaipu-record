import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ROUTES } from "@shared/routes";
import {
  __resetReadyCopiesForTests,
  getReadyCopies,
  noteFinishedCopy,
} from "@renderer/features/video-editor/export/ready-copies";
import { Sidebar } from "./sidebar";

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

afterEach(() => __resetReadyCopiesForTests());

describe("Sidebar Export entry and badge", () => {
  it("sits right under Editor", () => {
    renderAt("/");
    const labels = screen.getAllByRole("link").map((link) => link.textContent);
    expect(labels.indexOf("Export")).toBe(labels.indexOf("Editor") + 1);
  });

  it("is active on Export with and without a video", () => {
    renderAt("/export/asset-1");
    expect(exportLink()).toHaveAttribute("aria-current", "page");
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
    expect(getReadyCopies().copies).toEqual([{ assetId: "copy-1", announced: true }]);
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

  it("opening the copy's page forgets it", async () => {
    const router = renderAt("/");
    act(() => noteFinishedCopy("copy-1"));
    act(() => noteFinishedCopy("copy-2"));
    expect(exportLink()).toHaveAccessibleName(/2 copies in progress or ready/);
    await act(() => router.navigate("/library/copy-1"));
    expect(getReadyCopies().copies.map((c) => c.assetId)).toEqual(["copy-2"]);
  });
});
