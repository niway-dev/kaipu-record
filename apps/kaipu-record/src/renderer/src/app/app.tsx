import { AppRouter } from "./router";
import { OnboardingProvider } from "@renderer/features/onboarding";

export default function App(): React.JSX.Element {
  return (
    <OnboardingProvider>
      <AppRouter />
    </OnboardingProvider>
  );
}
