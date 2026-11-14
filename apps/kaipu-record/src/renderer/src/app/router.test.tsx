import { render, screen, waitFor } from "@testing-library/react";
import { Outlet } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Only the route table is under test: the shell and the pages it hosts are stubbed.
vi.mock("@renderer/shell/app-root", () => ({ AppRoot: () => <Outlet /> }));
vi.mock("@renderer/shell/app-shell", () => ({ AppShell: () => <Outlet /> }));
vi.mock("@renderer/pages/record/record-page", () => ({
  RecordPage: () => <p>capture page</p>,
}));

describe("AppRouter", () => {
  it("sends the old /screenshots route to the Capture page, replacing the entry", async () => {
    // An earlier entry the user came from. A replacing redirect leaves no /screenshots entry
    // in history, so going back lands on #/start, not on #/screenshots.
    window.location.hash = "#/start";
    window.location.hash = "#/screenshots";
    const { AppRouter } = await import("./router");
    render(<AppRouter />);
    expect(await screen.findByText("capture page")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/");
    window.history.back();
    await waitFor(() => expect(window.location.hash).toBe("#/start"));
  });
});
