import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

export default function CloudPromotion() {
  const t = useTranslations("auth");
  const legal = useTranslations("legal");
  return (
    <section className="mb-6 rounded-lg border border-border bg-muted/40 p-4 text-sm">
      <p className="font-semibold text-foreground">{t("cloudPromotion")}</p>
      <p className="mt-2 text-muted-foreground">{t("cloudActivation")}</p>
      <p className="mt-2 text-muted-foreground">{t("cloudPromotionNote")}</p>
      <Link
        to="/legal/cloud-terms"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-primary underline underline-offset-4"
      >
        {legal("readTerms")}
      </Link>
    </section>
  );
}
