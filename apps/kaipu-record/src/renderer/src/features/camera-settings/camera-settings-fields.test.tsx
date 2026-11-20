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

describe("CameraSettingsFields — what it no longer offers (NIW2-892)", () => {
  it("has no Shape, Size or Corners control before recording", () => {
    renderFields({ bubble: { ...bubble, shape: "rounded" } });
    expect(screen.queryByRole("radiogroup", { name: "Shape" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Size" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Bubble size" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Corners" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shape")).not.toBeInTheDocument();
    expect(screen.queryByText("Size")).not.toBeInTheDocument();
  });

  it("never writes shape, size or cornerRadius", async () => {
    const { onChange } = renderFields();
    await userEvent.click(screen.getByRole("radio", { name: "FaceTime HD" }));
    await userEvent.click(screen.getByRole("switch", { name: "Mirror my video" }));
    await userEvent.click(screen.getByRole("switch", { name: "Framing" }));
    for (const [patch] of onChange.mock.calls) {
      expect(patch).not.toHaveProperty("shape");
      expect(patch).not.toHaveProperty("size");
      expect(patch).not.toHaveProperty("cornerRadius");
    }
  });

  it("explains that the camera records on its own and is shaped in the editor", () => {
    renderFields();
    expect(
      screen.getByText(
        "Your camera records as its own full-quality video. Change its shape, size and position in the editor after you record.",
      ),
    ).toBeInTheDocument();
  });
});

describe("CameraSettingsFields — cameras", () => {
  it("lists the cameras as radios, default camera first, and no dropdown", () => {
    renderFields();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Camera device" });
    const names = Array.from(group.querySelectorAll('[role="radio"]')).map((r) => r.textContent);
    expect(names).toEqual(["Default camera", "FaceTime HD", "Camera 2"]);
    expect(screen.getByRole("radio", { name: "Default camera" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("writes the deviceId of the picked camera, or null for the default", async () => {
    const { onChange } = renderFields();
    await userEvent.click(screen.getByRole("radio", { name: "FaceTime HD" }));
    expect(onChange).toHaveBeenLastCalledWith({ deviceId: "cam-1" });
    await userEvent.click(screen.getByRole("radio", { name: "Default camera" }));
    expect(onChange).toHaveBeenLastCalledWith({ deviceId: null });
  });

  it("checks the chosen camera", () => {
    renderFields({ bubble: { ...bubble, deviceId: "cam-2" } });
    expect(screen.getByRole("radio", { name: "Camera 2" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Default camera" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("keys rows apart even when a camera's deviceId is the word default", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderFields({ cameras: [{ deviceId: "default", label: "Virtual camera" }] });
    const group = screen.getByRole("radiogroup", { name: "Camera device" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("keeps a remembered camera that is unplugged as the checked row", () => {
    renderFields({ bubble: { ...bubble, deviceId: "cam-gone" } });
    const missing = screen.getByRole("radio", { name: "Camera 3" });
    expect(missing).toHaveAttribute("aria-checked", "true");
    expect(missing).toHaveAttribute("data-missing", "true");
  });

  it("moves the selection with the arrow keys, with one tab stop", async () => {
    const { onChange } = renderFields();
    const first = screen.getByRole("radio", { name: "Default camera" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "FaceTime HD" })).toHaveAttribute("tabindex", "-1");
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith({ deviceId: "cam-1" });
    expect(screen.getByRole("radio", { name: "FaceTime HD" })).toHaveFocus();
  });

  it("scrolls inside its own box, never the popover, when there are more than five", () => {
    renderFields({
      cameras: Array.from({ length: 7 }, (_, i) => ({ deviceId: `c${i}`, label: `Cam ${i}` })),
    });
    const group = screen.getByRole("radiogroup", { name: "Camera device" });
    expect(group).toHaveAttribute("data-scrolls", "true");
  });

  it("does not scroll with five rows or fewer", () => {
    renderFields();
    expect(screen.getByRole("radiogroup", { name: "Camera device" })).not.toHaveAttribute(
      "data-scrolls",
    );
  });
});

describe("CameraSettingsFields — order and notes", () => {
  it("Tab goes cameras, then Mirror my video, then Framing", async () => {
    renderFields();
    screen.getByRole("radio", { name: "Default camera" }).focus();
    await userEvent.tab();
    expect(screen.getByRole("switch", { name: "Mirror my video" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("switch", { name: "Framing" })).toHaveFocus();
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
  it("shows a Mirror my video switch with its hint, on by default", () => {
    renderFields();
    const mirror = screen.getByRole("switch", { name: "Mirror my video" });
    expect(mirror).toHaveAttribute("aria-checked", "true");
    expect(mirror).toHaveAccessibleDescription(
      "Turn off when the camera faces away from you, so text reads correctly",
    );
  });

  it("writes mirrored: false when switched off", async () => {
    const { onChange } = renderFields();
    await userEvent.click(screen.getByRole("switch", { name: "Mirror my video" }));
    expect(onChange).toHaveBeenLastCalledWith({ mirrored: false });
  });

  it("reflects an off setting and turns it back on", async () => {
    const { onChange } = renderFields({ bubble: { ...bubble, mirrored: false } });
    const mirror = screen.getByRole("switch", { name: "Mirror my video" });
    expect(mirror).toHaveAttribute("aria-checked", "false");
    await userEvent.click(mirror);
    expect(onChange).toHaveBeenLastCalledWith({ mirrored: true });
  });

  it("works mid-take", () => {
    renderFields({ isRecording: true });
    expect(screen.getByRole("switch", { name: "Mirror my video" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("keeps the hints as descriptions and tooltips, not visible lines", () => {
    renderFields();
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

  it("shows the zoom slider and the position pad when on, mid-take", () => {
    renderFields({ bubble: { ...bubble, framing: on }, isRecording: true });
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
