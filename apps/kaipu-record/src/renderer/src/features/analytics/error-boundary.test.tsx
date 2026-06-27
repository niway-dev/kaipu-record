import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./analytics-client", () => ({ captureException: vi.fn() }));

import { captureException } from "./analytics-client";
import { ErrorBoundary } from "./error-boundary";

function Boom(): React.JSX.Element {
  throw new Error("render crash");
}

describe("ErrorBoundary", () => {
  it("renders a fallback and reports the error instead of crashing", () => {
    // jsdom logs the thrown error; silence the noise for a clean run.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/algo salió mal/i)).toBeInTheDocument();
    expect(captureException).toHaveBeenCalled();
    spy.mockRestore();
  });
});
