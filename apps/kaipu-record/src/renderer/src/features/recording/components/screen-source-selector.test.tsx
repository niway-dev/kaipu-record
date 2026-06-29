import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScreenSource } from "@shared/types/electron-api";
import { ScreenSourceSelector } from "./screen-source-selector";

const SCREENS: ScreenSource[] = [
  { id: "screen:1", name: "Entire Screen", thumbnail: "data:,", type: "screen" },
  { id: "screen:2", name: "Display 2", thumbnail: "data:,", type: "screen" },
];
const WINDOWS: ScreenSource[] = [
  { id: "window:1", name: "Safari", thumbnail: "data:,", type: "window" },
];
const ALL = [...SCREENS, ...WINDOWS];

function renderSelector(
  overrides: Partial<React.ComponentProps<typeof ScreenSourceSelector>> = {},
) {
  const onSelectSource = vi.fn();
  const onClose = vi.fn();
  const onGrantAccess = vi.fn();
  const result = render(
    <ScreenSourceSelector
      isOpen
      sources={ALL}
      isLoading={false}
      onClose={onClose}
      onSelectSource={onSelectSource}
      onGrantAccess={onGrantAccess}
      {...overrides}
    />,
  );
  return { ...result, onSelectSource, onClose, onGrantAccess };
}

describe("ScreenSourceSelector", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSelector({ isOpen: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows screen sources by default and selects one, then closes", () => {
    const { onSelectSource, onClose } = renderSelector();
    expect(screen.getByText("Entire Screen")).toBeInTheDocument();
    expect(screen.queryByText("Safari")).toBeNull(); // window source, hidden on the Screens tab

    fireEvent.click(screen.getByText("Entire Screen"));

    expect(onSelectSource).toHaveBeenCalledWith(SCREENS[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("filters to window sources on the Windows tab", () => {
    renderSelector();
    fireEvent.click(screen.getByRole("button", { name: "Windows" }));
    expect(screen.getByText("Safari")).toBeInTheDocument();
    expect(screen.queryByText("Entire Screen")).toBeNull();
  });

  it("shows the permission notice when screen access is off", () => {
    const { onGrantAccess } = renderSelector({ isAccessGranted: false });
    expect(screen.getByText("Screen Recording access is off")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(onGrantAccess).toHaveBeenCalled();
  });

  it("shows the loading state", () => {
    renderSelector({ isLoading: true });
    expect(screen.getByText(/loading sources/i)).toBeInTheDocument();
  });

  it("shows an error message", () => {
    renderSelector({ error: "desktopCapturer failed" });
    expect(screen.getByText("desktopCapturer failed")).toBeInTheDocument();
  });

  it("shows an empty state when the active tab has no sources", () => {
    renderSelector({ sources: WINDOWS }); // no screens → Screens tab is empty
    expect(screen.getByText(/no screens found/i)).toBeInTheDocument();
  });

  it("closes via the close button", () => {
    const { onClose } = renderSelector();
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when clicking the backdrop (but not the modal)", () => {
    const { container, onClose } = renderSelector();
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay); // target === currentTarget → closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
