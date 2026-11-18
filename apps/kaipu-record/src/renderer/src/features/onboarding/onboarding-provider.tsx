import React, { useCallback, useMemo, useState } from "react";
import { OnboardingContext } from "./onboarding-context";
import {
  hasCompletedOnboarding,
  hasSeenPrivacyNotice,
  markOnboardingComplete,
  markPrivacySeen,
} from "./onboarding-store";
import { OnboardingOverlay } from "./onboarding-overlay";
import { PrivacyNotice } from "./privacy-notice";

/**
 * Owns onboarding open/close state and renders the full-window overlay above the
 * rest of the app. Opens automatically on first run (when the localStorage flag
 * is unset) and exposes `open()` through context so Settings can replay it.
 *
 * Whoever has not yet seen the privacy step (finished onboarding before it existed, or skipped
 * the tour before reaching it) gets it once, as a notice over the app, after the overlay is
 * out of the way (NIW2-849).
 */
export function OnboardingProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Lazy initial state so we read localStorage exactly once on mount.
  const [isOpen, setIsOpen] = useState(() => !hasCompletedOnboarding());

  const [noticePending, setNoticePending] = useState(() => !hasSeenPrivacyNotice());

  const open = useCallback(() => setIsOpen(true), []);

  const finish = useCallback(() => {
    markOnboardingComplete();
    setIsOpen(false);
    // The overlay marks the step seen when it shows it; whoever left before it still owes it.
    setNoticePending(!hasSeenPrivacyNotice());
  }, []);

  const dismissNotice = useCallback(() => {
    markPrivacySeen();
    setNoticePending(false);
  }, []);

  const value = useMemo(() => ({ isOpen, open }), [isOpen, open]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {isOpen && <OnboardingOverlay onClose={finish} />}
      {!isOpen && noticePending && <PrivacyNotice onDismiss={dismissNotice} />}
    </OnboardingContext.Provider>
  );
}
