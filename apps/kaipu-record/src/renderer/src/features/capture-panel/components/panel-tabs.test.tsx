import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelTabs } from "./panel-tabs";

describe("PanelTabs", () => {
  it("renders both tabs and marks the active one selected", () => {
    render(<PanelTabs active="record" onChange={vi.fn()} />);
    const record = screen.getByRole("tab", { name: "Record" });
    const capture = screen.getByRole("tab", { name: "Capture" });
    expect(record).toHaveAttribute("aria-selected", "true");
    expect(capture).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange with the clicked tab", () => {
    const onChange = vi.fn();
    render(<PanelTabs active="record" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Capture" }));
    expect(onChange).toHaveBeenCalledWith("capture");
  });

  it("disables both tabs and ignores clicks when locked", () => {
    const onChange = vi.fn();
    render(<PanelTabs active="record" onChange={onChange} disabled />);
    const capture = screen.getByRole("tab", { name: "Capture" });
    expect(capture).toBeDisabled();
    fireEvent.click(capture);
    expect(onChange).not.toHaveBeenCalled();
  });
});
