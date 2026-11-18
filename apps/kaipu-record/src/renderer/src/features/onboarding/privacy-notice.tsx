import { ModalActions, ModalButton, ModalOverlay } from "@kaipu/ui";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { PrivacyContent } from "./privacy-content";
import common from "./steps/step.module.css";
import styles from "./privacy-notice.module.css";

/**
 * The privacy step for people who finished onboarding before it existed, shown once over the
 * app. The same content and the same toggle as the step; Got it (or Esc) dismisses it for good.
 */
export function PrivacyNotice({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  const t = useTranslations("onboarding");
  return (
    <ModalOverlay onCancel={onDismiss} labelledBy="privacy-notice-title" size="wide">
      <div {...uiArea("onboarding.privacyNotice")} className={styles.notice}>
        <h2 id="privacy-notice-title" className={common.title}>
          {t("privacyTitle")}
        </h2>
        <p className={common.subtitle}>{t("privacySubtitle")}</p>
        <PrivacyContent />
        <div className={styles.actions}>
          <ModalActions>
            <ModalButton variant="primary" onClick={onDismiss}>
              {t("privacyGotIt")}
            </ModalButton>
          </ModalActions>
        </div>
      </div>
    </ModalOverlay>
  );
}
