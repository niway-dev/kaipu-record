import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LevelSlider, SwitchRow } from "./audio-settings-fields";

function renderSlider(onChange = vi.fn(), value = 70, max = 200): ReturnType<typeof vi.fn> {
  render(
    <LevelSlider
      label="Input level"
      value={value}
      min={0}
      max={max}
      valueText={`${value}%`}
      icon={null}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("LevelSlider", () => {
  it("exposes the slider contract with a readable value", () => {
    renderSlider();
    const slider = screen.getByRole("slider", { name: "Input level" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "200");
    expect(slider).toHaveAttribute("aria-valuenow", "70");
    expect(slider).toHaveAttribute("aria-valuetext", "70%");
  });

  it("moves by 5 with the arrows, by 25 with Shift, and jumps with Home and End", async () => {
    const onChange = renderSlider();
    screen.getByRole("slider").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(75);
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(65);
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith(95);
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith(0);
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith(200);
  });

  it("stays inside its range", async () => {
    const onChange = renderSlider(vi.fn(), 98, 100);
    screen.getByRole("slider").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it("follows a pointer drag along the track", () => {
    const onChange = renderSlider(vi.fn(), 0, 100);
    const slider = screen.getByRole("slider");
    slider.getBoundingClientRect = () =>
      ({ left: 100, width: 200, right: 300, top: 0, bottom: 4, height: 4 }) as DOMRect;
    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(50);
    fireEvent.pointerMove(slider, { clientX: 250, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(75);
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(75);
  });
});

describe("SwitchRow", () => {
  it("toggles through role=switch", async () => {
    const onChange = vi.fn();
    render(<SwitchRow title="Noise" hint="Fans" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Noise" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("says why it is disabled, in place of its hint, and ignores presses", async () => {
    const onChange = vi.fn();
    render(
      <SwitchRow
        title="Duck"
        hint="Keeps your voice on top"
        checked={false}
        onChange={onChange}
        disabled
        disabledReason="Turn on the microphone to use this"
      />,
    );
    expect(screen.getByText("Turn on the microphone to use this")).toBeInTheDocument();
    expect(screen.queryByText("Keeps your voice on top")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still shows a disabled reason when the hint is hidden", () => {
    render(
      <SwitchRow
        title="Duck"
        hint="Keeps your voice on top"
        checked={false}
        onChange={() => {}}
        hintHidden
        disabled
        disabledReason="Turn on the microphone to use this"
      />,
    );
    const reason = screen.getByText("Turn on the microphone to use this");
    expect(reason.closest("[title]")).toBeNull();
    expect(screen.getByRole("switch")).toHaveAccessibleDescription(
      "Turn on the microphone to use this",
    );
  });
});
