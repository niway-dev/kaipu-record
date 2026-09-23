import { Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import styles from "./done-step.module.css";

export function DoneStep(): React.JSX.Element {
  const t = useTranslations("onboarding");
  // The live binding, never a literal: the default is ⌃⌘C and the user can rebind it
  // on the Shortcuts page. (The original screen shipped a hardcoded ⌘⇧P that no
  // shortcut ever matched.)
  const shortcuts = useShortcutLabels();
  return (
    <div className={styles.step}>
      <span className={styles.check}>
        <Check size={34} strokeWidth={2.4} />
      </span>
      <h1 className={styles.title}>{t("doneTitle")}</h1>
      <p className={styles.subtitle}>
        {t("donePressPre")} <kbd className={styles.kbd}>{shortcuts?.startRecording ?? "…"}</kbd>{" "}
        {t("donePressPost")}
      </p>
    </div>
  );
}
