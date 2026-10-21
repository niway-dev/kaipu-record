import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { SUPPORTED_LOCALES, useLocale, useSetLocale, useTranslations } from "@kaipu/i18n";
import type { AccountDeletionClient } from "@/lib/account-deletion";
import { hasPassword, useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { bp, kl } from "../dashboard/dashboard.stylex";
import { Card, PageHeading, PageStack } from "@/components/dashboard/ui";
import { DangerZone } from "./danger-zone";
import { StorageSection } from "./storage-section";

export interface SettingsPageProps {
  email: string;
  deletionEnabled: boolean;
  deletionClient: AccountDeletionClient;
  /**
   * Phone widths only: the theme switch and Sign out, which live in the sidebar on desktop.
   * The route passes them in, so this page stays free of the router.
   */
  mobileFooter?: ReactNode;
}

/** `/dashboard/settings`: plan and storage, language and the danger zone. */
export function SettingsPage({
  email,
  deletionEnabled,
  deletionClient,
  mobileFooter,
}: SettingsPageProps) {
  const t = useTranslations("dashboard");
  const accounts = useLinkedAccounts();

  return (
    <PageStack>
      <PageHeading title={t("settingsTitle")} description={t("settingsDescription")} />
      <StorageSection />
      <Card title={t("languageTitle")}>
        <div {...stylex.props(s.languageRow)}>
          <p {...stylex.props(s.languageText)}>{t("languageDescription")}</p>
          <LanguageSwitch />
        </div>
      </Card>
      <DangerZone
        email={email}
        hasPassword={hasPassword(accounts.data)}
        enabled={deletionEnabled}
        client={deletionClient}
      />
      {mobileFooter ? <div {...stylex.props(s.mobileOnly)}>{mobileFooter}</div> : null}
    </PageStack>
  );
}

const LOCALE_NAMES = { en: "English", es: "Español" } as const;

/** English / Español as a segmented control. Each name is written in its own language. */
function LanguageSwitch() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div role="radiogroup" aria-label={t("languageTitle")} {...stylex.props(s.segment)}>
      {SUPPORTED_LOCALES.map((code) => {
        const on = code === locale;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={on}
            lang={code}
            onClick={() => setLocale(code)}
            {...stylex.props(s.option, on && s.optionOn)}
          >
            {LOCALE_NAMES[code]}
          </button>
        );
      })}
    </div>
  );
}

const s = stylex.create({
  languageRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" },
  languageText: { flex: "1", minWidth: "200px", margin: 0, fontSize: "14px", color: kl.dim },
  segment: {
    display: "inline-flex",
    gap: "3px",
    padding: "3px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "999px",
    backgroundColor: kl.card2,
  },
  option: {
    height: "36px",
    paddingInline: "16px",
    borderStyle: "none",
    borderRadius: "999px",
    backgroundColor: "transparent",
    color: kl.dim,
    fontFamily: "inherit",
    fontSize: "13.5px",
    fontWeight: 600,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": "2px solid #f6055c" },
    outlineOffset: "2px",
  },
  optionOn: { backgroundColor: kl.card, color: kl.tx, boxShadow: "0 1px 0 var(--kl-bd-2)" },
  mobileOnly: { display: { default: "none", [bp.mobile]: "block" } },
});
