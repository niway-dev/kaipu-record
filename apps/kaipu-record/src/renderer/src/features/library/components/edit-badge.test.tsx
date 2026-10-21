import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditBadge } from "./edit-badge";

describe("EditBadge", () => {
  it("renders nothing for null", () => {
    const { container } = render(<EditBadge state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the accent badge with the hint for never-exported", () => {
    render(<EditBadge state="never-exported" />);
    const el = screen.getByText(/edited · not exported/i);
    expect(el).toHaveAttribute("title", expect.stringMatching(/original/i));
  });

  it("renders the stale badge with its own copy and hint, not the never-exported one", () => {
    // Distinct copy is the point: "not exported" on a recording that visibly has an
    // export reads as a bug. Same accent style, because in both states some edit is
    // in no file.
    render(<EditBadge state="stale" />);
    const el = screen.getByText(/latest edits not exported/i);
    expect(el).toHaveAttribute("title", expect.stringMatching(/export again/i));
    expect(screen.queryByText(/edited · not exported/i)).toBeNull();
  });

  it("renders the muted badge for edited", () => {
    render(<EditBadge state="edited" />);
    expect(screen.getByText(/^edited$/i)).toBeInTheDocument();
  });
});
