import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionGateOverlay } from "./version-gate-overlay";
import { VersionGateBanner } from "./version-gate-banner";

afterEach(() => vi.unstubAllGlobals());

describe("VersionGateOverlay", () => {
  it("renders the message and opens the download url", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(<VersionGateOverlay message="Actualizá" downloadUrl="https://x.test" />);
    expect(screen.getByText("Actualizá")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    expect(open).toHaveBeenCalledWith("https://x.test", "_blank");
  });

  it("has no dismiss affordance", () => {
    render(<VersionGateOverlay message="m" downloadUrl="https://x.test" />);
    expect(screen.queryByRole("button", { name: /cerrar|dismiss|close/i })).toBeNull();
  });
});

describe("VersionGateBanner", () => {
  it("renders and can be dismissed", () => {
    render(<VersionGateBanner message="Nueva versión" downloadUrl="https://x.test" />);
    expect(screen.getByText("Nueva versión")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Nueva versión")).toBeNull();
  });
});
