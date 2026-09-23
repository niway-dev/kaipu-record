import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditBadge } from "./edit-badge";

describe("EditBadge", () => {
  it("renders nothing for null", () => {
    const { container } = render(<EditBadge state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the accent badge with the hint for not-exported", () => {
    render(<EditBadge state="not-exported" />);
    const el = screen.getByText(/edited · not exported/i);
    expect(el).toHaveAttribute("title", expect.stringMatching(/original/i));
  });

  it("renders the muted badge for edited", () => {
    render(<EditBadge state="edited" />);
    expect(screen.getByText(/^edited$/i)).toBeInTheDocument();
  });
});
