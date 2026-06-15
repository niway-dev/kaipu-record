import React, { useCallback, useMemo, useState } from "react";
import { OnboardingContext } from "./onboarding-context";
import { hasCompletedOnboarding, markOnboardingComplete } from "./onboarding-store";
import { OnboardingOverlay } from "./onboarding-overlay";

/**
 * Owns onboarding open/close state and renders the full-window overlay above the
 * rest of the app. Opens automatically on first run (when the localStorage flag
 * is unset) and exposes `open()` through context so Settings can replay it.
 */
export function OnboardingProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Lazy initial state so we read localStorage exactly once on mount.
  const [isOpen, setIsOpen] = useState(() => !hasCompletedOnboarding());

  const open = useCallback(() => setIsOpen(true), []);

  const finish = useCallback(() => {
    markOnboardingComplete();
    setIsOpen(false);
  }, []);

  const value = useMemo(() => ({ isOpen, open }), [isOpen, open]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {isOpen && <OnboardingOverlay onClose={finish} />}
    </OnboardingContext.Provider>
  );
}
