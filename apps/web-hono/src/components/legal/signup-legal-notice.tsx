import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";
import { LEGAL_DOCUMENTS } from "./legal-config";

export function SignupLegalNotice({
  messageKey = "signupNotice",
}: {
  /** `googleSignupNotice` under the Google button: "By continuing with Google…" (NIW2-219, Q9). */
  messageKey?: "signupNotice" | "googleSignupNotice";
}) {
  const t = useTranslations("legal");
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {t.rich(messageKey, {
        terms: (chunks) => (
          <Link
            to={LEGAL_DOCUMENTS.terms}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {chunks}
          </Link>
        ),
        cloud: (chunks) => (
          <Link
            to={LEGAL_DOCUMENTS.cloud}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {chunks}
          </Link>
        ),
        privacy: (chunks) => (
          <Link
            to={LEGAL_DOCUMENTS.privacy}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
