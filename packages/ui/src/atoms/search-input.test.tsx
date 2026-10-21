import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "./search-input";

describe("SearchInput", () => {
  it("calls both onChange and onSearch, handing onSearch the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSearch = vi.fn();
    render(<SearchInput placeholder="Search" onChange={onChange} onSearch={onSearch} />);

    await user.type(screen.getByPlaceholderText("Search"), "a");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledWith("a");
  });

  it("works without an icon", () => {
    // The icon is injected rather than imported, so rendering without one has to
    // stay a supported case and not a broken layout.
    render(<SearchInput placeholder="Search" />);
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
  });

  it("renders an injected icon and hides it from assistive tech", () => {
    render(<SearchInput placeholder="Search" icon={<svg data-testid="glass" />} />);

    const icon = screen.getByTestId("glass");
    expect(icon.parentElement).toHaveAttribute("aria-hidden");
  });

  it("reserves the icon's lane only when there is an icon", () => {
    const { rerender } = render(<SearchInput placeholder="Search" />);
    const without = screen.getByPlaceholderText("Search").className;

    rerender(<SearchInput placeholder="Search" icon={<svg />} />);
    const with_ = screen.getByPlaceholderText("Search").className;

    expect(with_).not.toBe(without);
  });

  it("focuses the field when the surrounding label is clicked", async () => {
    const user = userEvent.setup();
    render(<SearchInput placeholder="Search" icon={<svg data-testid="glass" />} />);

    // The whole control is a <label>, which is why it needs no id to do this.
    await user.click(screen.getByTestId("glass"));

    expect(screen.getByPlaceholderText("Search")).toHaveFocus();
  });
});
