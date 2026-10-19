import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@kaipu/web-ui";
import { useAccountStorage } from "@/hooks/use-account-storage";
import { claimFirstVisit } from "@/lib/first-visit";
import { formatBytesForLocale } from "@/lib/format-bytes";

/**
 * "Your account is ready", shown on the first dashboard visit of this user in this browser.
 *
 * The storage read happens after mount (the server render has no `localStorage`, and a read during
 * render would make the first client render disagree with the markup). It stays on screen until
 * dismissed or until the next visit; it is never shown again for the same user. The plan line
 * only appears when the plan loaded: a failed request is the storage card's job to explain.
 */
export function FirstVisitWelcome({ userId }: { userId: string }) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("storageCloud");
  const locale = useLocale();
  const storage = useAccountStorage();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Only ever turns on: a second run of this effect (StrictMode) finds the flag set and must
    // not hide what the first one showed.
    if (claimFirstVisit(userId)) setShown(true);
  }, [userId]);

  if (!shown) return null;

  const planLine =
    storage.view.kind === "usage" && storage.plan
      ? t("firstVisitPlan", {
          plan: storage.plan.plan === "pro" ? ts("planPro") : ts("planFree"),
          capacity: formatBytesForLocale(storage.view.usage.capacityBytes, locale),
        })
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("firstVisitTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        {planLine ? <p>{planLine}</p> : <span />}
        <Button variant="outline" size="sm" onClick={() => setShown(false)}>
          {t("firstVisitDismiss")}
        </Button>
      </CardContent>
    </Card>
  );
}
