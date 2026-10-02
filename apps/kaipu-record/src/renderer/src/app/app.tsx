import { SharedProbe } from "@kaipu/ui";

import { AppRouter } from "./router";
// StyleX experiment: the sheet the postcss plugin writes the atomics into.
import "../dev/stylex-probe.css";
import { OnboardingProvider } from "@renderer/features/onboarding";
import { ErrorBoundary, useInitAnalytics } from "@renderer/features/analytics";
import { ToastHost } from "@renderer/ui";

export default function App(): React.JSX.Element {
  useInitAnalytics();
  return (
    <ErrorBoundary>
      {/* StyleX experiment: shared with the web home. */}
      <SharedProbe />
      <OnboardingProvider>
        <AppRouter />
      </OnboardingProvider>
      <ToastHost />
    </ErrorBoundary>
  );
}
