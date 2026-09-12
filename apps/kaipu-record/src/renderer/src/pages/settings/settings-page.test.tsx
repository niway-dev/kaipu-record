import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "./settings-page";
import { OnboardingContext } from "@renderer/features/onboarding/onboarding-context";

// SettingsPage reads the onboarding context for its "Replay" button. Provide a
// stub so the tests don't mount the real provider (which would open the overlay).
// The router is for the Account section, whose buttons navigate to the auth pages.
function renderSettings(open = vi.fn()): void {
  render(
    <MemoryRouter>
      <OnboardingContext.Provider value={{ isOpen: false, open }}>
        <SettingsPage />
      </OnboardingContext.Provider>
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  it("renders the storage and cloud section with its account block", () => {
    renderSettings();
    expect(
      screen.getByRole("heading", { level: 2, name: /^storage and cloud$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^account and capacity$/i })).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: /^local folder$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^save mode$/i })).toBeInTheDocument();
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
    renderSettings(open);
    screen.getByRole("button", { name: /replay/i }).click();
    expect(open).toHaveBeenCalledOnce();
  });
});
