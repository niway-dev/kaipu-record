import { useEffect, useRef } from "react";
import { Play } from "lucide-react";
import { useLocale, useSetLocale, useTranslations, type Locale } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";
import { uiArea } from "@renderer/lib/ui-area";
import { DEMO_ICONS, DEMO_IDS, OnboardingDemo, useReducedMotion, type DemoId } from "../demos";
import common from "./step.module.css";
import styles from "./welcome-step.module.css";

const CARD_TEXT = {
  record: { title: "cardRecordTitle", desc: "cardRecordDesc" },
  capture: { title: "cardCaptureTitle", desc: "cardCaptureDesc" },
  share: { title: "cardShareTitle", desc: "cardShareDesc" },
  editor: { title: "cardEditorTitle", desc: "cardEditorDesc" },
  workspaces: { title: "cardWorkspacesTitle", desc: "cardWorkspacesDesc" },
} as const satisfies Record<DemoId, { title: string; desc: string }>;

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
 * Language picker on the very first screen: without it a user who cannot read the
 * default language finishes onboarding unable to read it. Writes AppSettings.locale via
 * the provider, exactly like the Settings picker, so every window follows at once.
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

interface WelcomeStepProps {
  /** The demo playing, or null for the five cards. */
  demo: DemoId | null;
  onDemoChange: (demo: DemoId) => void;
}

/** Welcome: what Kaipu does, as five cards; a card plays its demo (about ten seconds, looping) in place. */
export function WelcomeStep({ demo, onDemoChange }: WelcomeStepProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  const reducedMotion = useReducedMotion();
  const activeSwitchRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef<Partial<Record<DemoId, HTMLButtonElement | null>>>({});
  const previousDemo = useRef<DemoId | null>(null);

  // The card or switcher button that had focus unmounts when the view swaps, so focus would
  // fall to BODY. Opening a demo focuses its switcher button; closing returns to its card.
  // The first render of the cards (no demo ever open) must not steal focus.
  useEffect(() => {
    if (demo) activeSwitchRef.current?.focus();
    else if (previousDemo.current) cardRefs.current[previousDemo.current]?.focus();
    previousDemo.current = demo;
  }, [demo]);

  if (demo) {
    return (
      <div {...uiArea("onboarding.demo")} className={`${common.step} ${styles.demoView}`}>
        <div className={styles.demoHead}>
          <div className={styles.switcher} role="group" aria-label={t("demoSwitcher")}>
            {DEMO_IDS.map((id) => {
              const Icon = DEMO_ICONS[id];
              const active = id === demo;
              const title = t(CARD_TEXT[id].title);
              return (
                <button
                  key={id}
                  type="button"
                  ref={active ? activeSwitchRef : undefined}
                  aria-pressed={active}
                  aria-label={title}
                  title={title}
                  className={active ? styles.switchActive : styles.switch}
                  onClick={() => onDemoChange(id)}
                >
                  <Icon size={13} />
                  {active && title}
                </button>
              );
            })}
          </div>
          <span className={styles.demoDesc}>{t(CARD_TEXT[demo].desc)}</span>
        </div>
        {/* Keyed so switching demos restarts the animation at its first beat. */}
        <OnboardingDemo key={demo} id={demo} reducedMotion={reducedMotion} />
      </div>
    );
  }

  return (
    <div {...uiArea("onboarding.welcomeStep")} className={`${common.step} ${styles.step}`}>
      <span className={common.mark}>
        <KaipuLogo use="app" size={64} />
      </span>
      <h1 className={`${common.title} ${styles.title}`}>{t("welcomeTitle")}</h1>
      <p className={styles.tagline}>{t("welcomeTagline")}</p>
      <div className={styles.cards}>
        {DEMO_IDS.map((id) => {
          const Icon = DEMO_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              ref={(el) => {
                cardRefs.current[id] = el;
              }}
              className={`${common.card} ${styles.featureCard} ${id === "editor" ? styles.featured : ""}`}
              onClick={() => onDemoChange(id)}
            >
              <span className={styles.cardHead}>
                <span className={styles.cardIcon}>
                  <Icon size={15} />
                </span>
                <span className={styles.cardTitle}>{t(CARD_TEXT[id].title)}</span>
                <span className={styles.watch}>
                  <Play size={10} fill="currentColor" strokeWidth={0} /> {t("watch")}
                </span>
              </span>
              <span className={styles.cardDesc}>{t(CARD_TEXT[id].desc)}</span>
            </button>
          );
        })}
      </div>
      <p className={common.note}>{t("welcomeHint")}</p>
      <LanguagePicker />
    </div>
  );
}
