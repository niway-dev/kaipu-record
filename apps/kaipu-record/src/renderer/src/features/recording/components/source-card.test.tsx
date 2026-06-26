import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceCard } from "./source-card";
import type { SelectedSource } from "@renderer/features/recording/types";

const SCREEN: SelectedSource = { id: "screen:1", name: "Screen 1", type: "screen" };

describe("SourceCard", () => {
  it("offers a Change action that fires onChoose", () => {
    const onChoose = vi.fn();
    render(<SourceCard source={SCREEN} onChoose={onChoose} />);
    const button = screen.getByRole("button", { name: /change/i });
    button.click();
    expect(onChoose).toHaveBeenCalledOnce();
  });

  it("prompts to choose when no source is selected", () => {
    render(<SourceCard source={null} onChoose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /choose/i })).toBeInTheDocument();
    expect(screen.getByText("No source selected")).toBeInTheDocument();
  });

  it("shows a LOCKED badge instead of Change while recording", () => {
    render(<SourceCard source={SCREEN} locked onChoose={vi.fn()} />);
    expect(screen.getByText(/locked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /change/i })).not.toBeInTheDocument();
  });
});
