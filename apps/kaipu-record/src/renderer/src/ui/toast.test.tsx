import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "./toast";
import { dismissToast, getToasts, showToast } from "./toast-store";

afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
});

describe("ToastHost", () => {
  it("renders an active toast's message", () => {
    render(<ToastHost />);
    act(() => {
      showToast({ message: "No pudimos guardar la grabación." });
    });
    expect(screen.getByText("No pudimos guardar la grabación.")).toBeInTheDocument();
  });

  it("invokes the retry action and dismisses on click", async () => {
    const retry = vi.fn();
    render(<ToastHost />);
    act(() => {
      showToast({ message: "Falló", action: { label: "Reintentar", onClick: retry } });
    });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
