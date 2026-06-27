import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePermissions } from "@renderer/features/permissions";
import { requiredPermissionsMet } from "./permissions";
import { WelcomeStep } from "./steps/welcome-step";
import { PermissionsStep } from "./steps/permissions-step";
import { DoneStep } from "./steps/done-step";
import styles from "./onboarding-overlay.module.css";

const STEP_COUNT = 3;
const PERMISSIONS_STEP = 1;
const CTA_LABELS = ["Get started", "Continue", "Start recording"];

interface OnboardingOverlayProps {
  /** Called when the user finishes the flow or skips it. */
  onClose: () => void;
}

/**
 * Full-window onboarding takeover: Welcome → Grant permissions → All set.
 * Owns the step index, live permission state, and keyboard navigation. The
 * Continue button on the permissions step is gated until the required
 * permissions (screen + microphone) are granted.
 */
export function OnboardingOverlay({ onClose }: OnboardingOverlayProps): React.JSX.Element {
  const [step, setStep] = useState(0);
  const { status, denied, request, openSettings } = usePermissions();

  const canAdvance = step !== PERMISSIONS_STEP || requiredPermissionsMet(status);
  const isLastStep = step === STEP_COUNT - 1;

  const advance = useCallback(() => {
    if (!canAdvance) return;
    if (isLastStep) onClose();
    else setStep((s) => s + 1);
  }, [canAdvance, isLastStep, onClose]);

  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

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
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Onboarding">
      <div className={styles.stage}>
        <div className={styles.content}>
          {step === 0 && <WelcomeStep />}
          {step === 1 && (
            <PermissionsStep
              status={status}
              denied={denied}
              onRequest={(kind) => void request(kind)}
              onOpenSettings={(kind) => void openSettings(kind)}
            />
          )}
          {step === 2 && <DoneStep />}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.back}
            onClick={back}
            style={{ visibility: step === 0 ? "hidden" : "visible" }}
          >
            <ArrowLeft size={17} strokeWidth={2} /> Back
          </button>

          <div className={styles.dots}>
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} className={i === step ? styles.dotActive : styles.dot} />
            ))}
          </div>

          <div className={styles.advance}>
            <button type="button" className={styles.cta} onClick={advance} disabled={!canAdvance}>
              {CTA_LABELS[step]} <ArrowRight size={18} strokeWidth={2} />
            </button>
            {!isLastStep && (
              <button type="button" className={styles.skip} onClick={onClose}>
                Skip setup
              </button>
            )}
          </div>
        </div>

        <div className={styles.hint}>
          PRESS ↵ TO CONTINUE&nbsp;&nbsp;·&nbsp;&nbsp;← → TO NAVIGATE
        </div>
      </div>
    </div>
  );
}
