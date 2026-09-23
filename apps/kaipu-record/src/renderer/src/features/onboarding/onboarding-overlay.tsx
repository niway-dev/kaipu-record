import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { usePermissions, useAccessibility } from "@renderer/features/permissions";
import { requiredPermissionsMet } from "./permissions";
import { WelcomeStep } from "./steps/welcome-step";
import { PermissionsStep } from "./steps/permissions-step";
import { DoneStep } from "./steps/done-step";
import styles from "./onboarding-overlay.module.css";

type StepId = "welcome" | "permissions" | "done";

const STEPS: readonly StepId[] = ["welcome", "permissions", "done"];

const CTA_LABEL_KEY: Record<StepId, "ctaGetStarted" | "ctaContinue" | "ctaStartRecording"> = {
  welcome: "ctaGetStarted",
  permissions: "ctaContinue",
  done: "ctaStartRecording",
};

interface OnboardingOverlayProps {
  /** Called when the user finishes the flow or skips it. */
  onClose: () => void;
}

/**
 * Full-window onboarding takeover: Welcome → Grant permissions → All set. Owns the
 * current step, live permission state, and keyboard navigation. The Continue button on
 * the permissions step is gated until the required permissions (screen + microphone)
 * are granted; camera and macOS Accessibility are optional rows on the same step.
 */
export function OnboardingOverlay({ onClose }: OnboardingOverlayProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  const [step, setStep] = useState(0);
  const { status, denied, request, openSettings } = usePermissions();
  const accessibility = useAccessibility();

  const activeStepId = STEPS[step];
  const canAdvance = activeStepId !== "permissions" || requiredPermissionsMet(status);
  const isLastStep = step === STEPS.length - 1;

  const advance = useCallback(() => {
    if (!canAdvance) return;
    if (isLastStep) onClose();
    else setStep((s) => s + 1);
  }, [canAdvance, isLastStep, onClose]);

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowRight") {
        if (canAdvance && !isLastStep) setStep((s) => s + 1);
      } else if (e.key === "ArrowLeft") {
        back();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, canAdvance, isLastStep, onClose]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={t("ariaOnboarding")}
    >
      <div className={styles.stage}>
        <div className={styles.content}>
          {activeStepId === "welcome" && <WelcomeStep />}
          {activeStepId === "permissions" && (
            <PermissionsStep
              status={status}
              denied={denied}
              onRequest={(kind) => void request(kind)}
              onOpenSettings={(kind) => void openSettings(kind)}
              accessibility={accessibility.status}
              onRequestAccessibility={() => void accessibility.request()}
            />
          )}
          {activeStepId === "done" && <DoneStep />}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.back}
            onClick={back}
            style={{ visibility: step === 0 ? "hidden" : "visible" }}
          >
            <ArrowLeft size={17} strokeWidth={2} /> {t("back")}
          </button>

          <div className={styles.dots}>
            {STEPS.map((id, i) => (
              <span key={id} className={i === step ? styles.dotActive : styles.dot} />
            ))}
          </div>

          <div className={styles.advance}>
            <button type="button" className={styles.cta} onClick={advance} disabled={!canAdvance}>
              {t(CTA_LABEL_KEY[activeStepId])} <ArrowRight size={18} strokeWidth={2} />
            </button>
            {!isLastStep && (
              <button type="button" className={styles.skip} onClick={onClose}>
                {t("skip")}
              </button>
            )}
          </div>
        </div>

        <div className={styles.hint}>{t("hint")}</div>
      </div>
    </div>
  );
}
