import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CameraBubbleSettings } from "@shared/camera-bubble";
import { CameraBlockedCard, CameraSettingsFields } from "./camera-settings-fields";

const bubble: CameraBubbleSettings = {
  shape: "circle",
  cornerRadius: 0.18,
  size: 240,
  deviceId: null,
  mirrored: true,
  framing: { enabled: false, zoom: 1, x: 0, y: 0 },
};

function renderFields(overrides: Partial<React.ComponentProps<typeof CameraSettingsFields>> = {}): {
  onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  render(
    <CameraSettingsFields
      bubble={bubble}
      onChange={onChange}
      cameras={[
        { deviceId: "cam-1", label: "FaceTime HD" },
        { deviceId: "cam-2", label: "" },
      ]}
      cameraOn
      isRecording={false}
      {...overrides}
    />,
  );
  return { onChange };
}

describe("CameraSettingsFields — shape", () => {
  it("is a radiogroup with one tab stop that ←/→ move", async () => {
    const { onChange } = renderFields();
    const group = screen.getByRole("radiogroup", { name: "Shape" });
    const circle = screen.getByRole("radio", { name: "Circle" });
    const rounded = screen.getByRole("radio", { name: "Square" });
    expect(group).toBeInTheDocument();
    expect(circle).toHaveAttribute("aria-checked", "true");
    expect(circle).toHaveAttribute("tabindex", "0");
    expect(rounded).toHaveAttribute("tabindex", "-1");

    circle.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ shape: "rounded" });
    expect(rounded).toHaveFocus();
    // The value is still "circle" (controlled, unchanged): ← wraps back to the last option.
    circle.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith({ shape: "rectangle" });
    expect(screen.getByRole("radio", { name: "Rectangle" })).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("CameraSettingsFields — corners", () => {
  it("has no corner slider for the circle", () => {
    renderFields();
    expect(screen.queryByRole("slider", { name: "Corners" })).not.toBeInTheDocument();
  });

  it.each(["rounded", "rectangle"] as const)(
    "offers 0–50 %% for the %s, and steps it by keyboard",
    async (shape) => {
      const { onChange } = renderFields({ bubble: { ...bubble, shape } });
      const slider = screen.getByRole("slider", { name: "Corners" });
      expect(slider).toHaveAttribute("aria-valuemin", "0");
      expect(slider).toHaveAttribute("aria-valuemax", "50");
      expect(slider).toHaveAttribute("aria-valuetext", "18%");
      slider.focus();
      await userEvent.keyboard("{End}");
      expect(onChange).toHaveBeenLastCalledWith({ cornerRadius: 0.5 });
      await userEvent.keyboard("{Home}");
      expect(onChange).toHaveBeenLastCalledWith({ cornerRadius: 0 });
    },
  );
});

describe("CameraSettingsFields — size", () => {
  it("names each chip with its preset and pixels", () => {
    renderFields();
    expect(screen.getByRole("radio", { name: "Medium, 240 pixels" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Small, 160 pixels" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Large, 360 pixels" })).toBeInTheDocument();
  });

  it("maps a chip to its preset size", async () => {
    const { onChange } = renderFields();
    await userEvent.click(screen.getByRole("radio", { name: "Large, 360 pixels" }));
    expect(onChange).toHaveBeenCalledWith({ size: 360 });
  });

  it("reads Custom and is not clickable while the size is a preset", async () => {
    const { onChange } = renderFields();
    const custom = screen.getByRole("radio", { name: "Custom" });
    expect(custom).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(custom);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a custom size on the Custom chip and checks it", () => {
    renderFields({ bubble: { ...bubble, size: 300 } });
    const custom = screen.getByRole("radio", { name: "Custom, 300 pixels" });
    expect(custom).toHaveAttribute("aria-checked", "true");
    expect(custom).toHaveTextContent("Custom · 300 px");
  });

  it("skips the disabled Custom chip with the arrow keys", async () => {
    const { onChange } = renderFields({ bubble: { ...bubble, size: 360 } });
    screen.getByRole("radio", { name: "Large, 360 pixels" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ size: 160 });
  });

  it("from the checked Custom chip, ← goes to the last preset and → to the first", async () => {
    const { onChange } = renderFields({ bubble: { ...bubble, size: 300 } });
    screen.getByRole("radio", { name: "Custom, 300 pixels" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith({ size: 360 });
    screen.getByRole("radio", { name: "Custom, 300 pixels" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ size: 160 });
  });
});

describe("CameraSettingsFields — slider", () => {
  it("spans 120–480 and describes its value", () => {
    renderFields({ bubble: { ...bubble, size: 300 } });
    const slider = screen.getByRole("slider", { name: "Bubble size" });
    expect(slider).toHaveAttribute("min", "120");
    expect(slider).toHaveAttribute("max", "480");
    expect(slider).toHaveAttribute("aria-valuetext", "300 pixels, Custom");
  });

  it("names the preset it sits on", () => {
    renderFields();
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "240 pixels, Medium");
  });

  it("moves 10 px with ←/→ and 40 px with Shift, stopping on a preset", () => {
    const { onChange } = renderFields({ bubble: { ...bubble, size: 300 } });
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ size: 310 });
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ size: 260 });
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    // 300 + 40 = 340 does not cross a preset; from 330 it would stop on 360.
    expect(onChange).toHaveBeenLastCalledWith({ size: 340 });
  });

  it("follows a drag", () => {
    const { onChange } = renderFields();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "410" } });
    expect(onChange).toHaveBeenLastCalledWith({ size: 410 });
  });
});

describe("CameraSettingsFields — device and notes", () => {
  it("lists the cameras, naming the unnamed ones, and picks one", async () => {
    const { onChange } = renderFields();
    const select = screen.getByRole("combobox", { name: "Camera device" });
    expect(screen.getByRole("option", { name: "Default camera" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "FaceTime HD" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Camera 2" })).toBeInTheDocument();
    await userEvent.selectOptions(select, "cam-1");
    expect(onChange).toHaveBeenLastCalledWith({ deviceId: "cam-1" });
    await userEvent.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith({ deviceId: null });
  });

  it("comes last in the Tab order", async () => {
    renderFields();
    screen.getByRole("radio", { name: "Circle" }).focus();
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Medium, 240 pixels" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("slider")).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("switch", { name: "Mirror image" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("switch", { name: "Framing" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("says when the camera is off", () => {
    renderFields({ cameraOn: false });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Camera is off. These apply when you turn it on.",
    );
  });

  it("says changes are live during a recording", () => {
    renderFields({ isRecording: true });
    const note = screen.getByRole("status");
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note).toHaveTextContent("Changes apply live and will show in the recording.");
  });

  it("says nothing when the camera is on and nothing records", () => {
    renderFields();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("CameraBlockedCard", () => {
  it("explains the block and opens System Settings", async () => {
    const onOpenSystemSettings = vi.fn();
    render(<CameraBlockedCard onOpenSystemSettings={onOpenSystemSettings} />);
    expect(screen.getByText("Camera access is blocked")).toBeInTheDocument();
    expect(
      screen.getByText("Allow Kaipu in System Settings → Privacy → Camera."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open System Settings" }));
    expect(onOpenSystemSettings).toHaveBeenCalledOnce();
  });
});

describe("CameraSettingsFields — mirror", () => {
  it("shows a Mirror image switch with its hint, on by default", () => {
    renderFields();
    const mirror = screen.getByRole("switch", { name: "Mirror image" });
    expect(mirror).toHaveAttribute("aria-checked", "true");
    expect(mirror).toHaveAccessibleDescription(
      "Turn off when the camera faces away from you, so text reads correctly",
    );
  });

  it("writes mirrored: false when switched off, and true when switched on", async () => {
    const { onChange } = renderFields();
    await userEvent.click(screen.getByRole("switch", { name: "Mirror image" }));
    expect(onChange).toHaveBeenLastCalledWith({ mirrored: false });
  });

  it("reflects an off setting and turns it back on", async () => {
    const { onChange } = renderFields({ bubble: { ...bubble, mirrored: false } });
    const mirror = screen.getByRole("switch", { name: "Mirror image" });
    expect(mirror).toHaveAttribute("aria-checked", "false");
    await userEvent.click(mirror);
    expect(onChange).toHaveBeenLastCalledWith({ mirrored: true });
  });

  it("is also there in the compact variant, and mid-take", () => {
    renderFields({ compact: true, isRecording: true });
    expect(screen.getByRole("switch", { name: "Mirror image" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("CameraSettingsFields — compact (capture panel)", () => {
  it("drops the Size chips and slider; the full variant keeps them", () => {
    renderFields({ compact: true });
    expect(screen.queryByRole("radiogroup", { name: "Size" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: /size/i })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Shape" })).toBeInTheDocument();
  });

  it("keeps the switch hints as descriptions and tooltips, not visible lines", () => {
    renderFields({ compact: true });
    const framing = screen.getByRole("switch", { name: "Framing" });
    expect(framing).toHaveAccessibleDescription("Zoom in and move the image inside the bubble");
    expect(framing.closest("[title]")).toHaveAttribute(
      "title",
      "Zoom in and move the image inside the bubble",
    );
  });
});

describe("CameraSettingsFields — framing", () => {
  const on = { enabled: true, zoom: 1.5, x: 0, y: 0 };

  it("shows a Framing switch with its hint, off by default and without controls", () => {
    renderFields();
    const framing = screen.getByRole("switch", { name: "Framing" });
    expect(framing).toHaveAttribute("aria-checked", "false");
    expect(framing).toHaveAccessibleDescription("Zoom in and move the image inside the bubble");
    expect(screen.queryByRole("slider", { name: "Zoom" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Image position")).not.toBeInTheDocument();
  });

  it("writes the whole framing object when switched on", async () => {
    const { onChange } = renderFields();
    await userEvent.click(screen.getByRole("switch", { name: "Framing" }));
    expect(onChange).toHaveBeenLastCalledWith({
      framing: { enabled: true, zoom: 1, x: 0, y: 0 },
    });
  });

  it("shows the zoom slider and the position pad when on, in both variants, mid-take", () => {
    renderFields({ bubble: { ...bubble, framing: on }, compact: true, isRecording: true });
    expect(screen.getByRole("slider", { name: "Zoom" })).toHaveAttribute("aria-valuetext", "150%");
    expect(screen.getByLabelText("Image position")).toHaveAttribute("aria-valuetext", "Centered");
  });

  it("zoom: arrows move 5 %, Shift 25 %", async () => {
    const { onChange } = renderFields({ bubble: { ...bubble, framing: on } });
    const zoom = screen.getByRole("slider", { name: "Zoom" });
    zoom.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, zoom: 1.55 } });
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, zoom: 1.25 } });
  });

  it("the pad is disabled and not focusable at 100 % zoom", () => {
    renderFields({ bubble: { ...bubble, framing: { ...on, zoom: 1 } } });
    const pad = screen.getByLabelText("Image position");
    expect(pad).toHaveAttribute("aria-disabled", "true");
    expect(pad).toHaveAttribute("tabindex", "-1");
  });

  it("the pad: arrows move 0.1, Shift 0.25, and the value text says where", async () => {
    const { onChange } = renderFields({ bubble: { ...bubble, framing: on } });
    const pad = screen.getByLabelText("Image position");
    pad.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, x: 0.1 } });
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, y: -0.1 } });
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, y: 0.25 } });
  });

  it("the pad stops at the edges", async () => {
    const { onChange } = renderFields({
      bubble: { ...bubble, framing: { ...on, x: 0.95 } },
    });
    screen.getByLabelText("Image position").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, x: 1 } });
  });

  it("the pad's value text reads left/right and up/down in percent", () => {
    renderFields({ bubble: { ...bubble, framing: { ...on, x: -0.4, y: -0.2 } } });
    expect(screen.getByLabelText("Image position")).toHaveAttribute(
      "aria-valuetext",
      "Left 40%, up 20%",
    );
  });

  it("dragging the dot writes the position under the pointer (right = positive x)", () => {
    const { onChange } = renderFields({ bubble: { ...bubble, framing: on } });
    const pad = screen.getByLabelText("Image position");
    pad.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect;
    fireEvent.pointerDown(pad, { clientX: 150, clientY: 25, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, x: 0.5, y: -0.5 } });
    fireEvent.pointerMove(pad, { clientX: 400, clientY: 100, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ framing: { ...on, x: 1, y: 1 } });
  });

  it("Reset recenters and sets zoom back to 100 %, keeping it on", async () => {
    const { onChange } = renderFields({
      bubble: { ...bubble, framing: { enabled: true, zoom: 2, x: 0.5, y: -0.5 } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith({
      framing: { enabled: true, zoom: 1, x: 0, y: 0 },
    });
  });
});
