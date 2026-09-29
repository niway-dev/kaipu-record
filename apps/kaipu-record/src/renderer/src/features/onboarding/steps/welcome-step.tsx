import { Monitor, Mic, Volume2, Video, type LucideIcon } from "lucide-react";
import { useLocale, useSetLocale, useTranslations, type Locale } from "@kaipu/i18n";
import { KaipuLogo } from "@renderer/shell/kaipu-logo";
import styles from "./welcome-step.module.css";

type FeatureLabelKey = "featScreen" | "featVoice" | "featAudio" | "featCamera";

const FEATURES: { icon: LucideIcon; labelKey: FeatureLabelKey }[] = [
  { icon: Monitor, labelKey: "featScreen" },
  { icon: Mic, labelKey: "featVoice" },
  { icon: Volume2, labelKey: "featAudio" },
  { icon: Video, labelKey: "featCamera" },
];

/**
 * Each language is named in itself, on purpose: the reader may not understand the
 * currently active language, and their own language's name is the one thing they can
 * always read. Not translated, so not in the message catalogs.
 */
const LANGUAGES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
];

/**
 * Language picker on the very first screen: the app boots in the persisted locale
 * (default "en"), and until now the only way to switch was Settings — after finishing
 * an onboarding in a language the user may not read. Writes AppSettings.locale via the
 * provider, exactly like the Settings picker, so every window follows at once.
 */
function LanguagePicker(): React.JSX.Element {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div className={styles.language} role="radiogroup" aria-label={t("language")}>
      {LANGUAGES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={locale === value}
          className={locale === value ? styles.languageActive : styles.languageOption}
          onClick={() => setLocale(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function WelcomeStep(): React.JSX.Element {
  const t = useTranslations("onboarding");
  return (
    <div className={styles.step}>
      <div className={styles.mark}>
        <KaipuLogo size={50} />
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
      <LanguagePicker />
    </div>
  );
}
