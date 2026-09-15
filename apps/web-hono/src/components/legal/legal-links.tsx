import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";
import { LEGAL_DOCUMENTS, type LegalDocumentId } from "./legal-config";

export function LegalLinks() {
  const t = useTranslations("legal");
  return (
    <nav
      aria-label={t("navigation")}
      className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm"
    >
      {(Object.keys(LEGAL_DOCUMENTS) as LegalDocumentId[]).map((id) => (
        <Link
          key={id}
          to={LEGAL_DOCUMENTS[id]}
          className="underline-offset-4 hover:underline focus-visible:underline"
        >
          {t(`${id}.title`)}
        </Link>
      ))}
    </nav>
  );
}
