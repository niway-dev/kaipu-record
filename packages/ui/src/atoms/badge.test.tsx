import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import * as stylex from "@stylexjs/stylex";
import { Badge } from "./badge";

/**
 * Same approach as the Button's tests: assert relationships between emitted
 * classes, never a hash. A hash changes with any value change — a refactor the
 * test must survive — while "warning and danger do not look the same" is the
 * property whose breakage a user would see.
 */
const classesOf = (text: string) =>
  new Set(screen.getByText(text).className.split(" ").filter(Boolean));

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Stale</Badge>);
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("gives each variant a different set of classes", () => {
    const variants = ["neutral", "success", "info", "warning", "danger"] as const;
    const seen = variants.map((variant) => {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      const classes = [...classesOf(variant)].sort().join(" ");
      unmount();
      return classes;
    });

    expect(new Set(seen).size).toBe(variants.length);
  });

  it("defaults to the neutral variant", () => {
    const { unmount } = render(<Badge>plain</Badge>);
    const implicit = [...classesOf("plain")].sort().join(" ");
    unmount();

    render(<Badge variant="neutral">plain</Badge>);
    expect([...classesOf("plain")].sort().join(" ")).toBe(implicit);
  });

  it("applies a consumer's style override on top of its own", () => {
    const extra = stylex.create({ mono: { letterSpacing: "0.08em" } });

    const { rerender } = render(<Badge>Granted</Badge>);
    const plain = [...classesOf("Granted")].sort();

    rerender(<Badge style={extra.mono}>Granted</Badge>);
    expect([...classesOf("Granted")].sort()).not.toEqual(plain);
  });
});
