import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useBlocker } from "react-router-dom";
import { closeTargetFor, prepareForSwitch } from "./prepare-switch";

/** An editor with unsaved work: its leave guard asks Discard or Keep editing. */
function DirtyEditor(): React.JSX.Element {
  const blocker = useBlocker(true);
  return (
    <div>
      editor
      {blocker.state === "blocked" && (
        <>
          <button onClick={() => blocker.proceed?.()}>Discard</button>
          <button onClick={() => blocker.reset?.()}>Keep editing</button>
        </>
      )}
    </div>
  );
}

function routerAt(path: string, editor: React.JSX.Element = <div>editor</div>) {
  return createMemoryRouter(
    [
      { path: "/", element: <div>record</div> },
      { path: "/library", element: <div>library</div> },
      { path: "/library/:assetId", element: <div>item</div> },
      { path: "/editor", element: <div>editor home</div> },
      { path: "/editor/video/:assetId", element: editor },
      { path: "/editor/image/:assetId", element: editor },
    ],
    { initialEntries: [path] },
  );
}

describe("closeTargetFor", () => {
  it("sends every page that holds one item back to its list, and leaves the rest", () => {
    expect(closeTargetFor("/editor/video/a1")).toBe("/editor");
    expect(closeTargetFor("/editor/image/a1")).toBe("/editor");
    expect(closeTargetFor("/editor/capture")).toBe("/editor");
    expect(closeTargetFor("/editor/new")).toBe("/editor");
    expect(closeTargetFor("/video-editor")).toBe("/editor");
    expect(closeTargetFor("/screenshot-editor")).toBe("/editor");
    expect(closeTargetFor("/library/a1")).toBe("/library");
    expect(closeTargetFor("/library")).toBeNull();
    expect(closeTargetFor("/")).toBeNull();
    expect(closeTargetFor("/settings/general")).toBeNull();
  });
});

describe("prepareForSwitch", () => {
  it("flushes pending saves first, then closes the open item", async () => {
    const router = routerAt("/editor/video/a1");
    render(<RouterProvider router={router} />);
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push(`flush at ${router.state.location.pathname}`);
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await prepareForSwitch(router, [flush]);
    });

    expect(ok).toBe(true);
    expect(order).toEqual(["flush at /editor/video/a1"]);
    expect(router.state.location.pathname).toBe("/editor");
  });

  it("a page with no item open is ready at once and stays where it is", async () => {
    const router = routerAt("/library");
    render(<RouterProvider router={router} />);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await prepareForSwitch(router, []);
    });
    expect(ok).toBe(true);
    expect(router.state.location.pathname).toBe("/library");
  });

  it("an unsaved editor's Keep editing cancels the switch and keeps the editor open", async () => {
    const router = routerAt("/editor/image/a1", <DirtyEditor />);
    render(<RouterProvider router={router} />);

    let result: Promise<boolean> | undefined;
    act(() => {
      result = prepareForSwitch(router, []);
    });
    fireEvent.click(await screen.findByText("Keep editing"));

    await expect(result).resolves.toBe(false);
    expect(router.state.location.pathname).toBe("/editor/image/a1");
  });

  it("an unsaved editor's Discard lets the switch go on", async () => {
    const router = routerAt("/editor/image/a1", <DirtyEditor />);
    render(<RouterProvider router={router} />);

    let result: Promise<boolean> | undefined;
    act(() => {
      result = prepareForSwitch(router, []);
    });
    fireEvent.click(await screen.findByText("Discard"));

    await expect(result).resolves.toBe(true);
    expect(router.state.location.pathname).toBe("/editor");
  });

  it("a flush that fails does not stop the editor's own guard from asking", async () => {
    const router = routerAt("/editor/image/a1", <DirtyEditor />);
    render(<RouterProvider router={router} />);
    const failing = vi.fn(async () => {
      throw new Error("disk full");
    });

    let result: Promise<boolean> | undefined;
    act(() => {
      result = prepareForSwitch(router, [failing]);
    });
    fireEvent.click(await screen.findByText("Keep editing"));

    await expect(result).resolves.toBe(false);
  });
});
