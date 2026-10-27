import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Volume2 } from "lucide-react";
import { ToggleSplit } from "./toggle-split";

const base = {
  icon: Volume2,
  label: "Audio",
  status: "ON",
  on: true,
  onToggle: vi.fn(),
  chevronLabel: "System audio settings",
  open: false,
  onOpenChange: vi.fn(),
};

describe("ToggleSplit", () => {
  it("does nothing from the body when it is disabled, but the chevron still opens", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ToggleSplit
        {...base}
        bodyDisabled
        bodyTitle="Not available"
        onToggle={onToggle}
        onOpenChange={onOpenChange}
      />,
    );
    const body = screen.getByTitle("Not available");
    expect(body).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(body);
    expect(onToggle).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
