import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionNotice } from "./permission-notice";

describe("PermissionNotice", () => {
  it("renders the label and opens settings when clicked", async () => {
    const onOpenSettings = vi.fn();
    render(<PermissionNotice label="Microphone access is off" onOpenSettings={onOpenSettings} />);

    expect(screen.getByText("Microphone access is off")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
