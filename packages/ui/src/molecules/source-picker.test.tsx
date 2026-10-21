import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcePicker } from "./source-picker";

const TABS = [
  { id: "screens", label: "Screens" },
  { id: "windows", label: "Windows" },
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof SourcePicker>> = {}) {
  const onClose = vi.fn();
  const onTabChange = vi.fn();
  const result = render(
    <SourcePicker
      title="Select a screen or window"
      tabs={TABS}
      activeTab="screens"
      onTabChange={onTabChange}
      onClose={onClose}
      {...overrides}
    >
      <p>content</p>
    </SourcePicker>,
  );
  return { ...result, onClose, onTabChange };
}

describe("SourcePicker", () => {
  it("shows the title, the tabs and its content", () => {
    renderPicker();
    expect(screen.getByRole("heading", { name: "Select a screen or window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Screens" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Windows" })).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("reports the tab that was clicked", () => {
    const { onTabChange } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Windows" }));
    expect(onTabChange).toHaveBeenCalledWith("windows");
  });

  it("marks only the active tab", () => {
    renderPicker({ activeTab: "windows" });
    expect(screen.getByRole("button", { name: "Windows" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "Screens" })).not.toHaveAttribute("data-active");
  });

  it("closes from the close button", () => {
    const { onClose } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a click on the bare backdrop, but not on a click inside", () => {
    const { container, onClose } = renderPicker();
    fireEvent.click(screen.getByText("content"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
