import { Check } from "lucide-react";
import styles from "./done-step.module.css";

export function DoneStep(): React.JSX.Element {
  return (
    <div className={styles.step}>
      <span className={styles.check}>
        <Check size={34} strokeWidth={2.4} />
      </span>
      <h1 className={styles.title}>You&apos;re all set</h1>
      <p className={styles.subtitle}>
        Press <kbd className={styles.kbd}>⌘⇧P</kbd> anywhere — even from the menu bar — to start
        recording.
      </p>
    </div>
  );
}
