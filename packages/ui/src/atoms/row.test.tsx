import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Row } from "./row";

describe("Row", () => {
  it("renders its label", () => {
    render(<Row label="Launch at login" />);
    expect(screen.getByText("Launch at login")).toBeInTheDocument();
  });

  it("renders the description and action only when given", () => {
    const { rerender } = render(<Row label="Theme" />);
    expect(screen.queryByText("Dark")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<Row label="Theme" description="Dark" action={<button>Change</button>} />);
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("hides the decorative icon from assistive tech", () => {
    render(<Row label="Cloud" icon={<svg data-testid="glyph" />} />);
    expect(screen.getByTestId("glyph").parentElement).toHaveAttribute("aria-hidden");
  });

  it("gives every row the same classes, divider included", () => {
    // The separator used to be `.row + .row`, which StyleX cannot express; it is
    // now a top border suppressed on `:first-child`. That is one atomic class on
    // every row with the exception encoded in the stylesheet — so identical
    // classNames here are the expected result, not a missing divider. What the
    // rule actually renders is checked against the emitted sheet in the build.
    const { container } = render(
      <>
        <Row label="First" />
        <Row label="Second" />
      </>,
    );
    const rows = [...container.children];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.className).toBe(rows[1]!.className);
    expect(rows[0]!.className.trim()).not.toBe("");
  });
});
