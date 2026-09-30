import { useTranslations } from "@kaipu/i18n";

const TERMS = [
  { termKey: "originKayTerm", bodyKey: "originKayBody" },
  { termKey: "originKhipuTerm", bodyKey: "originKhipuBody" },
] as const;

/**
 * The brand signature and where the name comes from. Canonical wording lives in
 * `marketing/brand-identity.md`; keep the note that Kaipu is a coined name, not
 * a literal Quechua translation.
 */
export function BrandOrigin() {
  const t = useTranslations("landing");
  return (
    <section id="origin" className="mx-auto max-w-3xl px-6 py-16 text-center">
      <p className="text-sm font-medium tracking-wide text-[var(--kaipu-text-muted)] uppercase">
        {t("originHeading")}
      </p>
      <p className="mt-4 text-3xl font-bold tracking-tight text-[var(--kaipu-accent-primary)] md:text-4xl">
        {t("originSignature")}
      </p>
      <p className="mt-3 font-mono text-sm text-[var(--kaipu-text-muted)]">{t("originFormula")}</p>

      <dl className="mt-10 grid gap-6 text-left sm:grid-cols-2">
        {TERMS.map(({ termKey, bodyKey }) => (
          <div
            key={termKey}
            className="rounded-xl border border-[var(--kaipu-border)] bg-[var(--kaipu-bg-card)] p-6"
          >
            <dt className="font-mono text-lg font-semibold text-[var(--kaipu-text-primary)]">
              {t(termKey)}
            </dt>
            <dd className="mt-2 text-sm text-[var(--kaipu-text-secondary)]">{t(bodyKey)}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 text-lg text-[var(--kaipu-text-secondary)]">{t("originBody")}</p>
      <p className="mt-4 text-sm text-[var(--kaipu-text-muted)]">{t("originNote")}</p>
    </section>
  );
}
