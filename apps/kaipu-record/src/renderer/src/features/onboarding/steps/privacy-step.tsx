import { ShieldCheck } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { PrivacyContent } from "../privacy-content";
import common from "./step.module.css";
import styles from "./privacy-step.module.css";

/** Your recordings are yours: what Kaipu sends, what it never does, and the toggle (on). */
export function PrivacyStep(): React.JSX.Element {
  const t = useTranslations("onboarding");
  return (
    <div {...uiArea("onboarding.privacyStep")} className={common.step}>
      <span className={styles.mark}>
        <ShieldCheck size={34} strokeWidth={1.6} />
      </span>
      <h1 className={common.title}>{t("privacyTitle")}</h1>
      <p className={common.subtitle}>{t("privacySubtitle")}</p>
      <PrivacyContent />
    </div>
  );
}
