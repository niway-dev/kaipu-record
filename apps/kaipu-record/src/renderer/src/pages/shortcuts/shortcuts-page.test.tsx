import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CAPTURE_MODES } from "@shared/types/screenshot-capture";
import { ShortcutsPage } from "./shortcuts-page";

describe("ShortcutsPage", () => {
  it("lists a rebindable shortcut for every capture mode when Window is enabled", async () => {
    render(<ShortcutsPage enabledModes={CAPTURE_MODES} />);
    expect(await screen.findByText("Capture window")).toBeInTheDocument();
    expect(screen.getByText("Capture screen")).toBeInTheDocument();
    expect(screen.getByText("Capture frame")).toBeInTheDocument();
  });

  it("does not list Capture window with the flag as shipped (Window off)", async () => {
    render(<ShortcutsPage />);
    expect(await screen.findByText("Capture screen")).toBeInTheDocument();
    expect(screen.getByText("Capture frame")).toBeInTheDocument();
    expect(screen.queryByText("Capture window")).not.toBeInTheDocument();
  });
});
