import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnvBadge } from "./env-badge";

describe("EnvBadge", () => {
  // Vitest runs with `import.meta.env.DEV === true`, so this covers the dev branch.
  // The production branch is the bundler's dead-code elimination, not runtime logic.
  it("marks the window as a dev build", () => {
    render(<EnvBadge />);
    expect(screen.getByText("local env")).toBeInTheDocument();
  });
});
