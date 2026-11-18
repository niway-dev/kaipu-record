import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pushFlagOverrides } from "../test/flag-overrides-stub";
import { EnvBadge } from "./env-badge";

describe("EnvBadge", () => {
  // Vitest runs with `import.meta.env.DEV === true`, so this covers the dev branch.
  // The production branch is the bundler's dead-code elimination, not runtime logic.
  it("marks the window as a dev build", () => {
    render(<EnvBadge />);
    expect(screen.getByText("local env")).toBeInTheDocument();
  });

  it("says when feature flags are overridden, and follows a toggle live", () => {
    render(<EnvBadge />);
    expect(screen.getByText("local env")).toBeInTheDocument();
    act(() => pushFlagOverrides({ "native-cursor-capture": true }));
    expect(screen.getByText("local env · flags overridden")).toBeInTheDocument();
    act(() => pushFlagOverrides({}));
    expect(screen.getByText("local env")).toBeInTheDocument();
  });
});
