import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { PermissionKind, ShortcutAction } from "@shared/types";
import { useTranslations } from "@kaipu/i18n";
import { usePermissions, useAccessibility } from "@renderer/features/permissions";
import { uiArea } from "@renderer/lib/ui-area";
import { requiredPermissionsMet } from "./permissions";
import { markPrivacySeen } from "./onboarding-store";
import {
  canAdvanceFrom,
  canJumpTo,
  PERMISSIONS_INDEX,
  skipActionFor,
  stepIndexFor,
  stepsFor,
  type StepId,
} from "./onboarding-flow";
import { useTranscriptionOffer } from "./use-transcription-offer";
import type { DemoId } from "./demos";
import { WelcomeStep } from "./steps/welcome-step";
import { PermissionsStep, type PendingGrant } from "./steps/permissions-step";
import { ShortcutsStep } from "./steps/shortcuts-step";
import { PrivacyStep } from "./steps/privacy-step";
import { TranscriptionStep } from "./steps/transcription-step";
import { DoneStep } from "./steps/done-step";
import styles from "./onboarding-overlay.module.css";

const STEP_LABEL_KEY: Record<
  StepId,
  | "stepLabelWelcome"
  | "stepLabelPermissions"
  | "stepLabelShortcuts"
  | "stepLabelPrivacy"
  | "stepLabelTranscription"
  | "stepLabelDone"
> = {
  welcome: "stepLabelWelcome",
  permissions: "stepLabelPermissions",
  shortcuts: "stepLabelShortcuts",
  privacy: "stepLabelPrivacy",
  transcription: "stepLabelTranscription",
  done: "stepLabelDone",
};

/** Buttons and fields keep their own Enter, so a focused card opens instead of advancing. */
function ownsEnter(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "A")
  );
}

interface OnboardingOverlayProps {
  /** Called when the user finishes the flow or skips it. */
  onClose: () => void;
}

/**
 * Full-window onboarding takeover: Welcome → Permissions → Shortcuts → (Transcription) →
 * Privacy → You're set. Transcription is there only while the speech model is on offer.
 * Owns the step, the demo playing on Welcome, the shortcuts tried and the grants in
 * flight. Only Permissions blocks: Continue there waits for screen and microphone.
 */
export function OnboardingOverlay({ onClose }: OnboardingOverlayProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  // The step is kept as an id, not an index: the list grows or shrinks when the transcription
  // offer arrives or goes away, and an index would then land on a different step.
  const [currentStep, setCurrentStep] = useState<StepId>("welcome");
  const [demo, setDemo] = useState<DemoId | null>(null);
  const [tried, setTried] = useState<ReadonlySet<ShortcutAction>>(() => new Set());
  const [pending, setPending] = useState<ReadonlySet<PendingGrant>>(() => new Set());
  const { status, denied, request, openSettings } = usePermissions();
  const accessibility = useAccessibility();
  const transcription = useTranscriptionOffer();
  const steps = stepsFor({ offerTranscription: transcription !== null });

  // The takeover cannot reflow below a point (see ONBOARDING_MIN_HEIGHT in main):
  // raise the window's minimum while it is up, and release it on unmount so the
  // rest of the app keeps its normal floor.
  useEffect(() => {
    window.electronAPI.setOnboardingWindowMode(true);
    return () => window.electronAPI.setOnboardingWindowMode(false);
  }, []);

  const step = stepIndexFor(steps, currentStep);
  const stepId = steps[step]!;
  const requiredMet = requiredPermissionsMet(status);
  const canAdvance = canAdvanceFrom(stepId, requiredMet);
  const isLastStep = step === steps.length - 1;

  // Once the privacy step has been on screen, the one-time notice has nothing left to say.
  useEffect(() => {
    if (stepId === "privacy") markPrivacySeen();
  }, [stepId]);

  // A global shortcut reaches main, never this window's keydown; main reports each one
  // it ran. Only a press made while the Shortcuts step is open counts as tried.
  useEffect(() => {
    if (stepId !== "shortcuts") return;
    return window.electronAPI.onShortcutFired((action) =>
      setTried((prev) => (prev.has(action) ? prev : new Set(prev).add(action))),
    );
  }, [stepId]);

  const goTo = useCallback(
    (to: number) => {
      if (to < 0 || to >= steps.length || !canJumpTo(step, to, requiredMet)) return;
      setDemo(null);
      setCurrentStep(steps[to]!);
    },
    [step, steps, requiredMet],
  );

  const advance = useCallback(() => {
    if (!canAdvance) return;
    if (isLastStep) onClose();
    else goTo(step + 1);
  }, [canAdvance, isLastStep, onClose, goTo, step]);

  const back = useCallback(() => {
    if (demo) setDemo(null);
    else goTo(step - 1);
  }, [demo, goTo, step]);

  const skipAction = skipActionFor(stepId, requiredMet);
  const skip = useCallback(() => {
    if (skipAction === "toPermissions") goTo(PERMISSIONS_INDEX);
    else if (skipAction === "close") onClose();
  }, [skipAction, goTo, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        if (ownsEnter(e.target)) return;
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowRight") {
        if (canAdvance && !isLastStep) goTo(step + 1);
      } else if (e.key === "ArrowLeft") {
        back();
      } else if (e.key === "Escape") {
        // Inside a demo, Esc returns to the cards first.
        if (demo) setDemo(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, canAdvance, isLastStep, goTo, step, demo, onClose]);

  const withPending = useCallback(async (grant: PendingGrant, run: () => Promise<void>) => {
    setPending((prev) => new Set(prev).add(grant));
    try {
      await run();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(grant);
        return next;
      });
    }
  }, []);

  // Each way out of You're set closes the onboarding first, so the capture widget opens
  // over the app, then takes the same path as the shortcut it names.
  const finishAndRecord = useCallback(() => {
    onClose();
    window.electronAPI.requestRecordSelector();
  }, [onClose]);

  const finishAndScreenshot = useCallback(() => {
    onClose();
    window.electronAPI.requestCaptureScreenshot();
  }, [onClose]);

  // Without a capture: the main window (Library, Settings) is the way in for someone who
  // only wants to look around first.
  const finishAndOpenApp = useCallback(() => {
    onClose();
    window.electronAPI.openMainWindow();
  }, [onClose]);

  return (
    <div
      {...uiArea("onboarding.root")}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={t("ariaOnboarding")}
    >
      <div className={styles.stage}>
        <div className={styles.content}>
          {stepId === "welcome" && <WelcomeStep demo={demo} onDemoChange={setDemo} />}
          {stepId === "permissions" && (
            <PermissionsStep
              status={status}
              denied={denied}
              pending={pending}
              onRequest={(kind: PermissionKind) => void withPending(kind, () => request(kind))}
              onOpenSettings={(kind) => void openSettings(kind)}
              accessibility={accessibility.status}
              onRequestAccessibility={() =>
                void withPending("accessibility", async () => {
                  await accessibility.request();
                })
              }
            />
          )}
          {stepId === "shortcuts" && <ShortcutsStep tried={tried} />}
          {stepId === "transcription" && transcription && (
            <TranscriptionStep
              model={transcription.model}
              onDownload={transcription.download}
              onAdvance={advance}
            />
          )}
          {stepId === "privacy" && <PrivacyStep />}
          {stepId === "done" && (
            <DoneStep
              onRecord={finishAndRecord}
              onScreenshot={finishAndScreenshot}
              onOpenApp={finishAndOpenApp}
            />
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.side}>
            {(step > 0 || demo) && (
              <button type="button" className={styles.back} onClick={back}>
                <ArrowLeft size={16} strokeWidth={1.8} /> {demo ? t("allFeatures") : t("back")}
              </button>
            )}
          </div>

          <div className={styles.progress}>
            <div className={styles.dots}>
              {steps.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  aria-label={t("goToStep", { n: i + 1 })}
                  aria-current={i === step ? "step" : undefined}
                  disabled={!canJumpTo(step, i, requiredMet)}
                  className={i === step ? styles.dotActive : i < step ? styles.dotDone : styles.dot}
                  onClick={() => goTo(i)}
                />
              ))}
            </div>
            <span className={styles.stepLabel}>{t(STEP_LABEL_KEY[stepId])}</span>
          </div>

          <div className={`${styles.side} ${styles.advance}`}>
            {!isLastStep && stepId !== "transcription" && (
              <button type="button" className={styles.cta} onClick={advance} disabled={!canAdvance}>
                {step === 0 ? t("ctaGetStarted") : t("ctaContinue")}
              </button>
            )}
            {skipAction === "blocked" ? (
              <span className={styles.skipNote}>{t("permNeeded")}</span>
            ) : skipAction !== "none" ? (
              <button type="button" className={styles.skip} onClick={skip}>
                {skipAction === "toPermissions" ? t("skipToPermissions") : t("skipTour")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
