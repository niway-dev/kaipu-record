import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShortcutsPage } from "./shortcuts-page";

describe("ShortcutsPage", () => {
  it("lists a rebindable shortcut for every capture mode, Window included", async () => {
    render(<ShortcutsPage />);
    expect(await screen.findByText("Capture window")).toBeInTheDocument();
    expect(screen.getByText("Capture screen")).toBeInTheDocument();
    expect(screen.getByText("Capture frame")).toBeInTheDocument();
  });
});
