import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as stylex from "@stylexjs/stylex";
import { Button } from "./button";

/**
 * These tests assert about relationships between the emitted classes, never
 * about a specific hash. A hash changes whenever a value changes, which is a
 * refactor the test should survive; "primary and danger do not look the same"
 * and "a disabled button carries no hover rule" are the properties that would
 * actually break the product.
 */
const classesOf = (name: RegExp | string) =>
  new Set(screen.getByRole("button", { name }).className.split(" ").filter(Boolean));

describe("Button", () => {
  it("renders its children as an accessible button", () => {
    render(<Button>Start Recording</Button>);
    expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
  });

  it("calls onClick when pressed", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);

    await user.click(screen.getByRole("button", { name: /go/i }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: /go/i }));

    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /go/i })).toBeDisabled();
  });

  it("drops the hover layer when disabled", () => {
    // The CSS this replaced guarded every hover with `:not(:disabled)`. Here the
    // guard is in the component, so the proof is that a disabled button carries
    // strictly fewer classes: the hover one is gone and the disabled one is not.
    const { rerender } = render(<Button>Go</Button>);
    const enabled = classesOf(/go/i);

    rerender(<Button disabled>Go</Button>);
    const disabled = classesOf(/go/i);

    const onlyWhenEnabled = [...enabled].filter((c) => !disabled.has(c));
    const onlyWhenDisabled = [...disabled].filter((c) => !enabled.has(c));

    expect(onlyWhenEnabled).not.toHaveLength(0);
    expect(onlyWhenDisabled).not.toHaveLength(0);
  });

  it("keeps the variant's fill while enabled — the hover layer must not erase it", () => {
    // Regression: the hover layer once said `backgroundColor: { default: null }`,
    // which in StyleX REMOVES the variant's background instead of keeping it.
    // Every enabled button rendered the browser's white with only the glow left.
    // A disabled button carries no hover layer, so it kept its fill — which is
    // what makes the two comparable: the only classes a disabled button may have
    // that the enabled one lacks are its own layer (opacity, cursor, box-shadow).
    // A fourth means the enabled button lost a property the variant set.
    const variants = ["primary", "danger", "ghost", "outline"] as const;
    for (const variant of variants) {
      const { rerender, unmount } = render(<Button variant={variant}>Go</Button>);
      const enabled = classesOf(/go/i);
      rerender(
        <Button variant={variant} disabled>
          Go
        </Button>,
      );
      const disabled = classesOf(/go/i);
      unmount();

      const onlyWhenDisabled = [...disabled].filter((c) => !enabled.has(c));
      expect(onlyWhenDisabled, variant).toHaveLength(3);
    }
  });

  it("gives each variant a different set of classes", () => {
    const variants = ["primary", "danger", "ghost", "outline"] as const;
    const seen = variants.map((variant) => {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      const classes = [...classesOf(variant)].sort().join(" ");
      unmount();
      return classes;
    });

    expect(new Set(seen).size).toBe(variants.length);
  });

  it("gives each size a different set of classes", () => {
    const sizes = ["sm", "default", "lg"] as const;
    const seen = sizes.map((size) => {
      const { unmount } = render(<Button size={size}>{size}</Button>);
      const classes = [...classesOf(size)].sort().join(" ");
      unmount();
      return classes;
    });

    expect(new Set(seen).size).toBe(sizes.length);
  });

  it("applies a consumer's style override on top of its own", () => {
    const extra = stylex.create({ wide: { paddingInline: "40px" } });

    const { rerender } = render(<Button>Go</Button>);
    const plain = classesOf(/go/i);

    rerender(<Button style={extra.wide}>Go</Button>);
    const overridden = classesOf(/go/i);

    // StyleX replaces the atomic class for a property it overrides rather than
    // appending one, so the assertion is that the set changed — not that it grew.
    expect([...overridden].sort()).not.toEqual([...plain].sort());
  });

  it("forwards native button attributes", () => {
    render(
      <Button type="submit" aria-label="Save the recording">
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: /save the recording/i });
    expect(button).toHaveAttribute("type", "submit");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    // A bare <button> inside a form defaults to type=submit. The desktop's
    // primitive had the same gap; naming it here keeps the answer deliberate.
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: /go/i })).toHaveAttribute("type", "button");
  });
});
