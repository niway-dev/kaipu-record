import { useState } from "react";
import { KaipuLogo, type LogoUse } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import styles from "./kai.module.css";

/**
 * Every mood is a mark the app actually shows, and its note says where. The
 * ring is a demonstration, not a character sheet: tapping `record` shows the
 * mark you get when recording is the selected capture mode, which is what the
 * menu bar does (`apps/kaipu-record/src/main/tray.ts` carries exactly the two
 * capture states). Nothing here claims Kai reacts to events on his own.
 */
const MOODS = [
  { id: "record", use: "record", name: "homeKaiMoodRecordName", note: "homeKaiMoodRecordNote" },
  {
    id: "screenshot",
    use: "screenshot",
    name: "homeKaiMoodScreenshotName",
    note: "homeKaiMoodScreenshotNote",
  },
  {
    id: "permissions",
    use: "permissions",
    name: "homeKaiMoodPermissionsName",
    note: "homeKaiMoodPermissionsNote",
  },
  { id: "done", use: "done", name: "homeKaiMoodDoneName", note: "homeKaiMoodDoneNote" },
  { id: "plain", use: "product", name: "homeKaiMoodRestingName", note: "homeKaiMoodRestingNote" },
] as const satisfies readonly { id: string; use: LogoUse; name: string; note: string }[];

/** `done` is the warmest mark, so it is what a visitor meets first. */
const DEFAULT_MOOD = 3;

/**
 * Who Kai is, where you meet him, and where the name comes from — the home's
 * third section, between the moments band and chapter 01.
 *
 * The origin block reuses the `origin*` messages the earlier home carried in
 * `BrandOrigin`: one etymology, one set of strings, as brand-identity.md
 * requires. The `+` and `=` are decoration; `originHeading` and `originFormula`
 * stay in the accessibility tree so the equation still reads as a sentence to a
 * screen reader instead of as three loose cards.
 */
export function Kai() {
  const t = useTranslations("landing");
  const [selected, setSelected] = useState(DEFAULT_MOOD);
  const mood = MOODS[selected];

  return (
    <section id="kai" className={`${styles.section} kl-dots`}>
      <div className={styles.grid}>
        <div className={styles.stage}>
          <div className={styles.ring}>
            {/* Decorative: the status card below carries the same meaning as text. */}
            <div className={styles.center} aria-hidden="true">
              <KaipuLogo use={mood.use} size={200} className={styles.centerFox} decoding="async" />
            </div>

            <div
              className={styles.orbit}
              role="group"
              aria-label={t("homeKaiTapHint")}
              style={{ "--kai-count": MOODS.length } as React.CSSProperties}
            >
              {MOODS.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.satellite}
                  style={{ "--kai-i": i } as React.CSSProperties}
                  aria-pressed={i === selected}
                  onClick={() => setSelected(i)}
                >
                  <KaipuLogo use={m.use} size={56} className={styles.satelliteFox} loading="lazy" />
                  <span className={styles.srOnly}>{t(m.name)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Announced on change, so the ring is usable without seeing it. */}
          <div className={styles.status} aria-live="polite">
            <KaipuLogo use={mood.use} size={36} className={styles.statusFox} decoding="async" />
            <div>
              <p className={styles.statusLabel}>Kai · {t(mood.name)}</p>
              <p className={styles.statusNote}>{t(mood.note)}</p>
            </div>
          </div>

          <p className={styles.hint}>{t("homeKaiTapHint")}</p>
        </div>

        <div>
          <p className={styles.eyebrow}>{t("homeKaiEyebrow")}</p>
          <h2 className={styles.title}>{t("homeKaiHeading")}</h2>
          <p className={styles.serif}>{t("originSignature")}</p>
          <p className={styles.body}>{t("homeKaiBody")}</p>

          <div className={styles.origin}>
            <h3 className={styles.srOnly}>{t("originHeading")}</h3>
            <p className={styles.srOnly}>{t("originFormula")}</p>

            <div className={styles.terms}>
              <div className={styles.card}>
                <p className={styles.cardLabel}>{t("originKayLabel")}</p>
                <p className={styles.cardTerm}>{t("originKayTerm")}</p>
                <p className={styles.cardBody}>{t("originKayBody")}</p>
              </div>
              <span className={styles.operator} aria-hidden="true">
                +
              </span>
              <div className={styles.card}>
                <p className={styles.cardLabel}>{t("originKhipuLabel")}</p>
                <p className={styles.cardTerm}>{t("originKhipuTerm")}</p>
                <p className={styles.cardBody}>{t("originKhipuBody")}</p>
              </div>
            </div>

            <div className={styles.result}>
              <span className={styles.operator} aria-hidden="true">
                =
              </span>
              <div className={styles.resultCard}>
                <KaipuLogo use="product" size={40} className={styles.resultFox} loading="lazy" />
                <div>
                  <p className={styles.resultName}>Kaipu</p>
                  <p className={styles.cardBody}>{t("originBody")}</p>
                </div>
              </div>
            </div>

            <p className={styles.note}>{t("originNote")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
