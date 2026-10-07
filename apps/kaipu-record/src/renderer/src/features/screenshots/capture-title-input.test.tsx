import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaptureTitleInput } from "./capture-title-input";
import { useCaptureTitle } from "./use-capture-title";

const AUTO = "Screenshot — 2026-10-07";

/** The input driven by the real hook, with the rename side effect injected. */
function Harness({ onRename }: { onRename: ((title: string) => void) | null }): React.JSX.Element {
  const title = useCaptureTitle(AUTO, onRename);
  return (
    <>
      <CaptureTitleInput title={title} />
      <output data-testid="committed">{title.title}</output>
      <button type="button">Save</button>
    </>
  );
}

const field = (): HTMLInputElement => screen.getByRole("textbox", { name: /title/i });

describe("CaptureTitleInput", () => {
  it("is prefilled with the auto title, which is also its placeholder", () => {
    render(<Harness onRename={null} />);
    expect(field()).toHaveValue(AUTO);
    expect(field()).toHaveAttribute("placeholder", AUTO);
  });

  it("commits the typed name on Enter", async () => {
    render(<Harness onRename={null} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "Login bug{Enter}");
    expect(screen.getByTestId("committed")).toHaveTextContent("Login bug");
    expect(field()).not.toHaveFocus();
  });

  it("commits on blur (clicking Save moves focus away first)", async () => {
    render(<Harness onRename={null} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "Login bug");
    expect(screen.getByTestId("committed")).toHaveTextContent(AUTO);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("committed")).toHaveTextContent("Login bug");
  });

  it("reverts to the last committed title on Esc", async () => {
    render(<Harness onRename={null} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "Login bug{Enter}");
    await userEvent.clear(field());
    await userEvent.type(field(), "typo{Escape}");
    expect(field()).toHaveValue("Login bug");
    expect(screen.getByTestId("committed")).toHaveTextContent("Login bug");
  });

  it("falls back to the auto title when emptied", async () => {
    render(<Harness onRename={null} />);
    await userEvent.clear(field());
    await userEvent.tab();
    expect(field()).toHaveValue(AUTO);
    expect(screen.getByTestId("committed")).toHaveTextContent(AUTO);
  });

  it("renames a saved capture on blur or Enter, only when the name changed", async () => {
    const onRename = vi.fn();
    render(<Harness onRename={onRename} />);
    await userEvent.click(field());
    await userEvent.tab();
    expect(onRename).not.toHaveBeenCalled();

    await userEvent.clear(field());
    await userEvent.type(field(), "Login bug{Enter}");
    expect(onRename).toHaveBeenCalledExactlyOnceWith("Login bug");

    await userEvent.type(field(), " — fixed");
    await userEvent.tab();
    expect(onRename).toHaveBeenLastCalledWith("Login bug — fixed");
    expect(onRename).toHaveBeenCalledTimes(2);
  });
});
