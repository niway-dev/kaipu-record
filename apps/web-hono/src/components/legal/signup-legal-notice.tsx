import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";
import { LEGAL_DOCUMENTS } from "./legal-config";

export function SignupLegalNotice({
  messageKey = "signupNotice",
  tone = "app",
}: {
  /**
   * `googleSignupNotice` under the Google button: "By continuing with Google…" (NIW2-219, Q9).
   * `signinNotice` on the sign-in tab: the short "By continuing you agree to the Terms…" line.
   */
  messageKey?: "signupNotice" | "googleSignupNotice" | "signinNotice";
  /**
   * `app` uses the app theme's muted text. `inherit` takes the colour of the surrounding page —
   * the auth pages, which draw with the landing's `--kl-*` palette in both themes — and links in
   * its pink-for-text.
   */
  tone?: "app" | "inherit";
}) {
  const t = useTranslations("legal");
  const text =
    tone === "app"
      ? "text-xs leading-relaxed text-muted-foreground"
      : "m-0 text-xs leading-relaxed";
  const link =
    tone === "app"
      ? "underline underline-offset-2"
      : "text-[var(--kl-pink-tx)] underline-offset-2 hover:underline";
  const legalLink = (to: (typeof LEGAL_DOCUMENTS)[keyof typeof LEGAL_DOCUMENTS]) => {
    function LegalLink(chunks: React.ReactNode) {
      return (
        <Link to={to} target="_blank" rel="noopener noreferrer" className={link}>
          {chunks}
        </Link>
      );
    }
    return LegalLink;
  };
  return (
    <p className={text}>
      {t.rich(messageKey, {
        terms: legalLink(LEGAL_DOCUMENTS.terms),
        cloud: legalLink(LEGAL_DOCUMENTS.cloud),
        privacy: legalLink(LEGAL_DOCUMENTS.privacy),
      })}
    </p>
  );
}
