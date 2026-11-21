import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingContext } from "@renderer/features/onboarding/onboarding-context";
import { HeaderActions, HeaderEnd } from "@renderer/features/workspaces/header-slot";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { TitleBar } from "./title-bar";
import { resetHistoryPositionForTests } from "./use-history-position";

const workspaces = vi.hoisted(() => ({ present: true }));
vi.mock("@renderer/features/workspaces/workspaces-context", () => ({
  useOptionalWorkspaces: () => (workspaces.present ? {} : null),
}));
vi.mock("@renderer/features/workspaces/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <button type="button">switcher</button>,
}));

function setPlatform(platform: string, adminMode = false): void {
  Object.defineProperty(window, "electronAPI", {
    value: { platform, adminMode },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  workspaces.present = true;
  setPlatform("darwin");
});

describe("TitleBar", () => {
  it("shows the Admin badge right after the name while the process runs in Admin mode", () => {
    setPlatform("darwin", true);
    render(<TitleBar />);
    const badge = screen.getByText("👑 Admin");
    const name = screen.getByText("Kaipu Record");
    expect(name.nextElementSibling).toBe(badge);
  });

  it("shows no badge in User mode", () => {
    render(<TitleBar />);
    expect(screen.queryByText(/Admin/)).toBeNull();
  });

  it("shows the name and the workspace switcher", () => {
    render(<TitleBar />);
    expect(screen.getByText("Kaipu Record")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "switcher" })).toBeInTheDocument();
  });

  // The CSS leaves the OS controls' side empty by platform: the traffic lights on the left,
  // the Windows / Linux overlay on the right.
  it.each(["darwin", "win32", "linux"])("tells the CSS it runs on %s", (platform) => {
    setPlatform(platform);
    render(<TitleBar />);
    expect(screen.getByRole("banner")).toHaveAttribute("data-platform", platform);
  });

  it("keeps the bar but drops the switcher where there is no workspace to switch", () => {
    render(<TitleBar workspace={false} />);
    expect(screen.getByText("Kaipu Record")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "switcher" })).toBeNull();
  });

  it("drops the switcher outside the workspaces provider", () => {
    workspaces.present = false;
    render(<TitleBar />);
    expect(screen.queryByRole("button", { name: "switcher" })).toBeNull();
  });

  it("drops the switcher while onboarding covers the window", () => {
    render(
      <OnboardingContext.Provider value={{ isOpen: true, open: () => {} }}>
        <TitleBar />
      </OnboardingContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "switcher" })).toBeNull();
  });

  // NIW2-619: the editor's actions sit in the bar's right side, left of the item chip.
  it("renders a page's actions on the right, before its item chip", () => {
    render(
      <>
        <TitleBar />
        <HeaderEnd>
          <span>chip</span>
        </HeaderEnd>
        <HeaderActions>
          <button type="button">Export</button>
        </HeaderActions>
      </>,
    );
    const bar = screen.getByRole("banner");
    const exportButton = screen.getByRole("button", { name: "Export" });
    const chip = screen.getByText("chip");
    expect(bar.contains(exportButton)).toBe(true);
    expect(
      exportButton.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("removes the actions with the page that rendered them", () => {
    const view = render(
      <>
        <TitleBar />
        <HeaderActions>
          <button type="button">Export</button>
        </HeaderActions>
      </>,
    );
    act(() => view.rerender(<TitleBar />));
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  });
});

describe("TitleBar history arrows", () => {
  function mount(workspace = true): void {
    const router = createHashRouter([
      { path: "/", element: <TitleBar workspace={workspace} /> },
      { path: "/a", element: <TitleBar workspace={workspace} /> },
    ]);
    render(<RouterProvider router={router} />);
  }

  afterEach(() => {
    resetHistoryPositionForTests();
    window.history.replaceState(null, "", "#/");
  });

  it("sit after the logo, both dim on the first page", () => {
    mount();
    const back = screen.getByRole("button", { name: "Back" });
    const forward = screen.getByRole("button", { name: "Forward" });
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();
    const name = screen.getByText("Kaipu Record");
    expect(back.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("go back through the router's history", async () => {
    mount();
    await act(async () => {
      window.history.pushState({ idx: 1 }, "", "#/a");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    // The hook only knows what the router pushed; a hand-pushed entry carries idx itself.
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeEnabled();
    await act(async () => {
      const popped = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      back.click();
      await popped;
    });
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
  });

  // Wachiman on PR #545: a page pushed on sign-in (the arrows hidden) drops the browser's
  // forward entries; the tracking must see it, or Forward comes back lit with nothing ahead.
  it("keep tracking while hidden, so Forward is honest after a sign-in round trip", async () => {
    let onSignIn = false;
    function Bar(): React.JSX.Element {
      return <TitleBar workspace={!onSignIn} />;
    }
    const router = createHashRouter([
      { path: "/", element: <Bar /> },
      { path: "/a", element: <Bar /> },
      { path: "/b", element: <Bar /> },
      { path: "/sign-in", element: <Bar /> },
    ]);
    render(<RouterProvider router={router} />);
    const back = async (): Promise<void> => {
      await act(async () => {
        const popped = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        await router.navigate(-1);
        await popped;
      });
    };
    // "/" → "/a" → "/b", then back to "/": two entries ahead.
    await act(async () => {
      await router.navigate("/a");
      await router.navigate("/b");
    });
    await back();
    await back();
    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
    // Sign in from "/": the push drops "/a" and "/b" while the arrows are hidden; the page
    // then replaces itself with where the user came from.
    onSignIn = true;
    await act(async () => {
      await router.navigate("/sign-in");
    });
    expect(screen.queryByRole("button", { name: "Forward" })).toBeNull();
    onSignIn = false;
    await act(async () => {
      await router.navigate("/a", { replace: true });
    });
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("stay out of the sign-in and error bars", () => {
    mount(false);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("stay out while onboarding covers the window", () => {
    const router = createHashRouter([
      {
        path: "/",
        element: (
          <OnboardingContext.Provider value={{ isOpen: true, open: () => {} }}>
            <TitleBar />
          </OnboardingContext.Provider>
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("are absent without a router, so the bar still draws", () => {
    render(<TitleBar />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
