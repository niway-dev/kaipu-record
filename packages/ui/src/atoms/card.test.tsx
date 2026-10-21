import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import * as stylex from "@stylexjs/stylex";
import { Card } from "./card";

describe("Card", () => {
  it("renders its children", () => {
    render(
      <Card>
        <p>Storage</p>
      </Card>,
    );
    expect(screen.getByText("Storage")).toBeInTheDocument();
  });

  it("carries styling classes rather than rendering a bare div", () => {
    // The whole component is its surface: border, radius, background, overflow.
    // A Card that emitted no classes would still pass a children test while
    // rendering nothing anyone would recognise as a card.
    render(
      <Card>
        <p>Storage</p>
      </Card>,
    );
    const card = screen.getByText("Storage").parentElement!;
    expect(card.className.trim()).not.toBe("");
  });

  it("applies a consumer's style override on top of its own", () => {
    const extra = stylex.create({ padded: { padding: "16px" } });
    const classesOf = () => screen.getByText("Storage").parentElement!.className.split(" ").sort();

    const { rerender } = render(
      <Card>
        <p>Storage</p>
      </Card>,
    );
    const plain = classesOf();

    rerender(
      <Card style={extra.padded}>
        <p>Storage</p>
      </Card>,
    );
    expect(classesOf()).not.toEqual(plain);
  });
});
