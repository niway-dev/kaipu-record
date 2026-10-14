import { ArrowRight, Check, Clock, FolderOpen, ShieldCheck } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { cssVars } from "@/components/home/css-vars";
import { PixelGrid } from "@/components/home/pixel-grid";
import { useReveal } from "@/components/home/use-reveal";
import {
  COMING_NEXT,
  FEATURE_CHAPTERS,
  FEATURE_COUNT,
  PRIVACY,
  type Feature,
  type FeatureChapter,
  type FeatureChip,
} from "./features-config";
import styles from "./features.module.css";

/**
 * Keys come from features-config.ts, typed there as plain strings; its test proves
 * each one exists in both catalogs. This is the one place that trust is spent.
 */
type FeaturesT = ReturnType<typeof useTranslations<"features">>;
const msg = (t: FeaturesT, key: string): string => t(key as Parameters<FeaturesT>[0]);

const tintVars = (tint: FeatureChapter["tint"]) =>
  cssVars({
    "--kl-tint": `var(--kl-${tint})`,
    "--kl-tint-from": `var(--kl-${tint}-from)`,
    "--kl-tint-to": `var(--kl-${tint}-to)`,
  });

/** The opening screen: the promise, then one card per chapter as the page's index. */
export function FeaturesHero() {
  const t = useTranslations("features");

  return (
    <section id="top" className={`${styles.hero} kl-dots`}>
      <div className="kl-glow kl-glow-hero" aria-hidden />
      <PixelGrid className={styles.heroPixels} />

      <div className={styles.container}>
        <p className={styles.eyebrow}>{t("eyebrow", { count: FEATURE_COUNT })}</p>
        <h1 className={styles.h1}>{t("title")}</h1>
        <p className={styles.h1Serif}>{t("serif")}</p>
        <p className={styles.lead}>{t("lead")}</p>

        <nav className={styles.index} aria-label={t("indexLabel")}>
          {FEATURE_CHAPTERS.map((chapter) => {
            const Icon = chapter.icon;
            return (
              <a
                key={chapter.id}
                href={`#${chapter.id}`}
                className={styles.indexCard}
                style={tintVars(chapter.tint)}
              >
                <span className={styles.indexTop}>
                  <span className={`${styles.indexIcon} kl-chapter-icon`} aria-hidden>
                    <Icon size={20} />
                  </span>
                  <span className={styles.mono}>{chapter.number}</span>
                </span>
                <span className={styles.indexName}>{msg(t, chapter.name)}</span>
                <span className={styles.indexLine}>{msg(t, chapter.line)}</span>
                <span className={`${styles.mono} ${styles.indexCount}`}>
                  {t("count", { count: chapter.features.length })}
                  <ArrowRight size={12} aria-hidden />
                </span>
              </a>
            );
          })}
        </nav>

        <div className={styles.extraLinks}>
          <a href="#files" className={styles.extraLink}>
            <FolderOpen size={14} aria-hidden />
            {t("linkFiles")}
          </a>
          <a href="#private" className={styles.extraLink}>
            <ShieldCheck size={14} aria-hidden />
            {t("linkPrivate")}
          </a>
          <a href="#next" className={styles.extraLink}>
            <Clock size={14} aria-hidden />
            {t("linkNext")}
          </a>
        </div>
      </div>
    </section>
  );
}

/** One chapter: its header, then a grid of feature cards. */
export function FeatureChapterSection({ chapter }: { chapter: FeatureChapter }) {
  const t = useTranslations("features");
  const { ref, shown } = useReveal<HTMLDivElement>();
  const Icon = chapter.icon;

  return (
    <section id={chapter.id} className={styles.chapter} style={tintVars(chapter.tint)}>
      <div className="kl-glow kl-glow-chapter" aria-hidden />

      <div className={styles.container}>
        <header className={styles.chapterHead}>
          <div className={styles.chapterHeadMain}>
            <div className={styles.chapterMeta}>
              <span className={`${styles.chapterIcon} kl-chapter-icon`} aria-hidden>
                <Icon size={24} />
              </span>
              <span className={styles.chapterMetaText}>
                <span className={styles.mono}>{chapter.number} / 04</span>
                <span className={styles.chapterPill}>
                  <strong>{msg(t, chapter.name)}</strong> ·{" "}
                  {t("count", { count: chapter.features.length })}
                </span>
              </span>
            </div>
            <h2 className={styles.h2}>{msg(t, chapter.title)}</h2>
            <p className={styles.h2Serif}>{msg(t, chapter.serif)}</p>
          </div>
          <p className={styles.chapterIntro}>{msg(t, chapter.intro)}</p>
        </header>

        <div ref={ref} className={`${styles.cards} kl-reveal`} data-kl-shown={shown}>
          {chapter.features.map((feature) => (
            <FeatureCard key={feature.id} feature={feature} t={t} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature, t }: { feature: Feature; t: FeaturesT }) {
  const Icon = feature.icon;
  const span = feature.span ?? 1;

  return (
    <article className={styles.card} data-span={span}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden>
          <Icon size={17} />
        </span>
        <h3 className={styles.cardTitle}>{msg(t, feature.title)}</h3>
      </div>
      <p className={styles.cardBody}>{msg(t, feature.body)}</p>

      {feature.details && (
        <ul className={styles.details}>
          {feature.details.map((key) => (
            <li key={key} className={styles.detail}>
              <Check size={14} strokeWidth={2.4} className={styles.detailTick} aria-hidden />
              {msg(t, key)}
            </li>
          ))}
        </ul>
      )}

      {feature.chips && (
        <div className={styles.chips}>
          {feature.chips.map((chip) => (
            <Chip key={chip.key} chip={chip} label={msg(t, chip.key)} />
          ))}
        </div>
      )}
    </article>
  );
}

function Chip({ chip, label }: { chip: FeatureChip; label: string }) {
  return (
    <span className={styles.chip} data-kind={chip.kind}>
      {chip.kind === "tag" && (
        <span className={styles.tagDot} style={{ background: chip.color }} aria-hidden />
      )}
      {chip.kind === "fits" && <Check size={12} strokeWidth={2.4} aria-hidden />}
      {chip.prefix && <kbd className={styles.kbd}>{chip.prefix}</kbd>}
      {label}
    </span>
  );
}

/** What Kaipu will not do: no account, no watermark, no screen in the analytics. */
export function PrivateByDesign() {
  const t = useTranslations("features");

  return (
    <section id="private" className={styles.private}>
      <div className={`kl-glow ${styles.privateGlow}`} aria-hidden />
      <div className={styles.container}>
        <p className={styles.eyebrow}>{t("private.eyebrow")}</p>
        <h2 className={styles.h2}>{t("private.title")}</h2>
        <p className={styles.h2Serif}>{t("private.serif")}</p>

        <div className={styles.privateGrid}>
          {PRIVACY.map(({ id, icon: Icon }) => (
            <article key={id} className={styles.privateCard}>
              <span className={styles.privateIcon} aria-hidden>
                <Icon size={19} />
              </span>
              <h3 className={styles.privateTitle}>{t(`private.items.${id}.title`)}</h3>
              <p className={styles.privateBody}>{t(`private.items.${id}.body`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Planned work, muted and labelled — never dressed up as shipped. Mirrors the roadmap. */
export function ComingNext() {
  const t = useTranslations("features");

  return (
    <section id="next" className={styles.next}>
      <div className={styles.container}>
        <div className={styles.nextHead}>
          <span className={styles.plannedBadge}>{t("next.badge")}</span>
          <h2 className={styles.nextTitle}>{t("next.title")}</h2>
          <p className={styles.nextNote}>
            {t("next.note")}{" "}
            <a href="/roadmap" className={styles.nextLink}>
              {t("next.roadmapLink")}
            </a>
          </p>
        </div>
        <ul className={styles.nextGrid}>
          {COMING_NEXT.map(({ id, icon: Icon }) => (
            <li key={id} className={styles.nextItem}>
              <Icon size={18} aria-hidden />
              {t(`next.items.${id}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
