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
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const libraryLink = (): HTMLElement => screen.getByRole("link", { name: /^Library/ });

afterEach(() => __resetReadyCopiesForTests());

describe("Sidebar Library badge (NIW2-586)", () => {
  it("counts copies that finished out of sight, and clears when the Library opens", async () => {
    const router = renderAt("/");
    expect(libraryLink()).toHaveTextContent(/^Library$/);
    act(() => noteFinishedCopy("copy-1"));
    expect(libraryLink()).toHaveAccessibleName(/1 new copy ready/);
    expect(libraryLink()).toHaveTextContent("1");

    await act(() => router.navigate(ROUTES.library));
    expect(libraryLink()).toHaveTextContent(/^Library$/);
    // Still pointed at on the Library page until the copy itself is opened.
    expect(getReadyCopies().copies).toEqual([{ assetId: "copy-1", announced: true }]);
  });

  it("a copy that finishes while the Library is open never badges", () => {
    renderAt(ROUTES.library);
    act(() => noteFinishedCopy("copy-1"));
    expect(libraryLink()).toHaveTextContent(/^Library$/);
  });

  it("opening the copy's page forgets it", async () => {
    const router = renderAt("/");
    act(() => noteFinishedCopy("copy-1"));
    act(() => noteFinishedCopy("copy-2"));
    expect(libraryLink()).toHaveAccessibleName(/2 new copies ready/);
    await act(() => router.navigate("/library/copy-1"));
    expect(getReadyCopies().copies.map((c) => c.assetId)).toEqual(["copy-2"]);
  });
});
