import { AppRouter } from "./router";
import { OnboardingProvider } from "@renderer/features/onboarding";
import { ErrorBoundary, useInitAnalytics } from "@renderer/features/analytics";
import { ToastHost } from "@renderer/ui";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";

export default function App(): React.JSX.Element {
  useInitAnalytics();
  return (
    <ErrorBoundary>
      <OnboardingProvider>
        <WorkspacesProvider>
          <AppRouter />
        </WorkspacesProvider>
      </OnboardingProvider>
      <ToastHost />
    </ErrorBoundary>
  );
}
