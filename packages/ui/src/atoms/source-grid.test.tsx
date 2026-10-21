import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SourceGrid,
  SourcePickerLoading,
  SourcePickerMessage,
  SourceThumbFallback,
  SourceThumbImage,
  SourceTile,
} from "./source-grid";

describe("SourceTile", () => {
  it("shows its label and thumbnail", () => {
    render(
      <SourceGrid>
        <SourceTile
          thumbnail={<SourceThumbImage src="data:," alt="Entire Screen" />}
          label="Entire Screen"
          onSelect={() => {}}
        />
      </SourceGrid>,
    );
    expect(screen.getByRole("img", { name: "Entire Screen" })).toBeInTheDocument();
    expect(screen.getByText("Entire Screen", { selector: "div" })).toBeInTheDocument();
  });

  it("fires onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<SourceTile thumbnail={null} label="Safari" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Safari"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("marks the active tile and styles it differently", () => {
    const { container, rerender } = render(
      <SourceTile thumbnail={null} label="Safari" onSelect={() => {}} />,
    );
    const idle = (container.firstChild as HTMLElement).className;
    expect(container.firstChild).not.toHaveAttribute("data-active");

    rerender(<SourceTile thumbnail={null} label="Safari" isActive onSelect={() => {}} />);
    expect(container.firstChild).toHaveAttribute("data-active", "true");
    expect((container.firstChild as HTMLElement).className).not.toBe(idle);
  });
});

describe("SourceThumbImage", () => {
  it("reports a load failure so the caller can swap in the fallback", () => {
    const onError = vi.fn();
    render(<SourceThumbImage src="broken" alt="Window" onError={onError} />);
    fireEvent.error(screen.getByRole("img"));
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("SourceThumbFallback", () => {
  it("renders its icon and hides it from assistive technology", () => {
    render(
      <SourceThumbFallback>
        <svg data-testid="icon" />
      </SourceThumbFallback>,
    );
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });
});

describe("picker states", () => {
  it("renders a message", () => {
    render(
      <SourcePickerMessage>
        <p>No screens found</p>
      </SourcePickerMessage>,
    );
    expect(screen.getByText("No screens found")).toBeInTheDocument();
  });

  it("renders the loading caption", () => {
    render(
      <SourcePickerLoading>
        <p>Loading sources</p>
      </SourcePickerLoading>,
    );
    expect(screen.getByText("Loading sources")).toBeInTheDocument();
  });
});
