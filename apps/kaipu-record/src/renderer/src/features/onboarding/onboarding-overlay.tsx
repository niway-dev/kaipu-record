import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { usePermissions, useAccessibility } from "@renderer/features/permissions";
import { requiredPermissionsMet } from "./permissions";
import { WelcomeStep } from "./steps/welcome-step";
import { PermissionsStep } from "./steps/permissions-step";
import { AccessibilityStep } from "./steps/accessibility-step";
import { DoneStep } from "./steps/done-step";
import styles from "./onboarding-overlay.module.css";

type StepId = "welcome" | "permissions" | "accessibility" | "done";

const CTA_LABEL_KEY: Record<
  StepId,
  "ctaGetStarted" | "ctaContinue" | "accessibilitySkip" | "ctaStartRecording"
> = {
  welcome: "ctaGetStarted",
  permissions: "ctaContinue",
  // "Ahora no" / "Not now" — this step is optional, so its own CTA continues without
  // granting (see plans/video-editor-v2/03 § UI).
  accessibility: "accessibilitySkip",
  done: "ctaStartRecording",
};

interface OnboardingOverlayProps {
  /** Called when the user finishes the flow or skips it. */
  onClose: () => void;
}

/**
 * Full-window onboarding takeover: Welcome → Grant permissions → (macOS, not yet
 * trusted: Accessibility) → All set. Owns the current step id, live permission state, and
 * keyboard navigation. The Continue button on the permissions step is gated until the
 * required permissions (screen + microphone) are granted; every other step (including
 * the optional Accessibility one) can always advance.
 */
export function OnboardingOverlay({ onClose }: OnboardingOverlayProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  // Tracked by id, never by index. The step list is derived from a live permission
  // status that can change at any moment — `useAccessibility` re-reads it on window
  // focus, which is precisely what happens when the user returns from System Settings
  // — so the list can grow or shrink under whatever step is showing. An index means
  // the same number points at a different step (or past the end) the instant that
  // happens; an id keeps pointing at the step the user is actually looking at.
  const [currentStepId, setCurrentStepId] = useState<StepId>("welcome");
  const { status, denied, request, openSettings } = usePermissions();
  const accessibility = useAccessibility();

  // Only insert the step on macOS while it isn't already trusted — an already-granted
  // or non-mac install has nothing to onboard here. `status` defaults to "not-required"
  // until the IPC resolves, so the step may appear a moment after mount; tracking by id
  // is what makes that harmless.
  const steps = useMemo<StepId[]>(
    () =>
      accessibility.status === "denied"
        ? ["welcome", "permissions", "accessibility", "done"]
        : ["welcome", "permissions", "done"],
    [accessibility.status],
  );

  // The one id that can vanish from under the user is "accessibility": granting the
  // permission removes its own step. Falling forward to "done" is the right landing —
  // they just completed the thing the step was asking for.
  const rawIndex = steps.indexOf(currentStepId);
  const step = rawIndex === -1 ? steps.length - 1 : rawIndex;
  const activeStepId = steps[step] as StepId;

  const canAdvance = activeStepId !== "permissions" || requiredPermissionsMet(status);
  const isLastStep = step === steps.length - 1;

  const advance = useCallback(() => {
    if (!canAdvance) return;
    if (isLastStep) onClose();
    else setCurrentStepId(steps[step + 1]);
  }, [canAdvance, isLastStep, onClose, steps, step]);

  const back = useCallback(() => {
    if (step > 0) setCurrentStepId(steps[step - 1]);
  }, [steps, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowRight") {
        if (canAdvance && !isLastStep) setCurrentStepId(steps[step + 1]);
      } else if (e.key === "ArrowLeft") {
        back();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, canAdvance, isLastStep, onClose, steps, step]);

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
            />
          )}
          {activeStepId === "accessibility" && (
            <AccessibilityStep
              status={accessibility.status}
              onGrant={() => void accessibility.request()}
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
            {steps.map((id, i) => (
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
