import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPage } from "./settings-page";
import { OnboardingContext } from "@renderer/features/onboarding/onboarding-context";

// SettingsPage reads the onboarding context for its "Replay" button. Provide a
// stub so the tests don't mount the real provider (which would open the overlay).
function renderSettings(): void {
  render(
    <OnboardingContext.Provider value={{ isOpen: false, open: vi.fn() }}>
      <SettingsPage />
    </OnboardingContext.Provider>,
  );
}

describe("SettingsPage", () => {
  it("renders the account section", () => {
    renderSettings();
    expect(screen.getByRole("heading", { name: /^account$/i })).toBeInTheDocument();
  });

  it("renders the page heading", () => {
    renderSettings();
    expect(screen.getByRole("heading", { level: 1, name: /settings/i })).toBeInTheDocument();
  });

  it("renders only the wired settings sections", () => {
    renderSettings();
    expect(screen.getByRole("heading", { name: /^permissions$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^theme$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recording quality/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^files$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^app$/i })).toBeInTheDocument();
  });

  it("does not render unwired placeholder settings", () => {
    renderSettings();
    // These controls had no backend wiring and were removed (tracked in the
    // settings-roadmap backlog). They must not reappear as inert placeholders.
    expect(screen.queryByRole("heading", { name: /storage & uploads/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^devices$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
  });

  it("renders permission request controls", () => {
    renderSettings();
    expect(screen.getAllByRole("button", { name: /request/i }).length).toBeGreaterThan(0);
  });

  it("replays onboarding when the Replay button is clicked", () => {
    const open = vi.fn();
    render(
      <OnboardingContext.Provider value={{ isOpen: false, open }}>
        <SettingsPage />
      </OnboardingContext.Provider>,
    );
    screen.getByRole("button", { name: /replay/i }).click();
    expect(open).toHaveBeenCalledOnce();
  });
});
