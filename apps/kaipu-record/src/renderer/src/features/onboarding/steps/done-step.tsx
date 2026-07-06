import { Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./done-step.module.css";

export function DoneStep(): React.JSX.Element {
  const t = useTranslations("onboarding");
  return (
    <div className={styles.step}>
      <span className={styles.check}>
        <Check size={34} strokeWidth={2.4} />
      </span>
      <h1 className={styles.title}>{t("doneTitle")}</h1>
      <p className={styles.subtitle}>
        {t("donePressPre")} <kbd className={styles.kbd}>⌘⇧P</kbd> {t("donePressPost")}
      </p>
    </div>
  );
}
