import { AppRouter } from "./router";
import { OnboardingProvider } from "@renderer/features/onboarding";
import { ErrorBoundary, useInitAnalytics } from "@renderer/features/analytics";
import { ToastHost } from "@renderer/ui";

export default function App(): React.JSX.Element {
  useInitAnalytics();
  return (
    <ErrorBoundary>
      <OnboardingProvider>
        <AppRouter />
      </OnboardingProvider>
      <ToastHost />
    </ErrorBoundary>
  );
}
