import { Monitor, Mic, Volume2, Video, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./welcome-step.module.css";

type FeatureLabelKey = "featScreen" | "featVoice" | "featAudio" | "featCamera";

const FEATURES: { icon: LucideIcon; labelKey: FeatureLabelKey }[] = [
  { icon: Monitor, labelKey: "featScreen" },
  { icon: Mic, labelKey: "featVoice" },
  { icon: Volume2, labelKey: "featAudio" },
  { icon: Video, labelKey: "featCamera" },
];

function KaipuMark(): React.JSX.Element {
  return (
    <svg width={50} height={50} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4.6c0-1 1.05-1.6 1.9-1.1l12.3 6.8c.85.47.85 1.7 0 2.17L6.9 21.1c-.85.48-1.9-.12-1.9-1.1z"
        fill="var(--accent-primary)"
      />
      <path
        d="M8.4 8.6c0-.5.55-.82 1-.55l5.3 3.1c.45.27.45.92 0 1.18l-5.3 3.1c-.45.27-1-.05-1-.55z"
        fill="var(--bg-app)"
      />
    </svg>
  );
}

export function WelcomeStep(): React.JSX.Element {
  const t = useTranslations("onboarding");
  return (
    <div className={styles.step}>
      <div className={styles.mark}>
        <KaipuMark />
      </div>
      <h1 className={styles.title}>{t("welcomeTitle")}</h1>
      <p className={styles.subtitle}>{t("welcomeSubtitle")}</p>
      <div className={styles.features}>
        {FEATURES.map(({ icon: Icon, labelKey }) => (
          <div key={labelKey} className={styles.feature}>
            <Icon size={23} strokeWidth={1.7} className={styles.featureIcon} />
            <span className={styles.featureLabel}>{t(labelKey)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
