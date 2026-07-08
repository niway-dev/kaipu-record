import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeSettings } from "./theme-settings";

describe("ThemeSettings", () => {
  it("renders both theme options", () => {
    render(<ThemeSettings theme="dark" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
  });

  it("reports the picked theme", () => {
    const onChange = vi.fn();
    render(<ThemeSettings theme="dark" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(onChange).toHaveBeenCalledWith("light");
  });
});
