import { createContext, useContext } from "react";

export interface OnboardingContextValue {
  /** Whether the onboarding overlay is currently open. */
  isOpen: boolean;
  /** Open the onboarding overlay (used by Settings → Replay). */
  open: () => void;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within <OnboardingProvider>");
  }
  return ctx;
}
