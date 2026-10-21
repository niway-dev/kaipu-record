import { useEffect, useState } from "react";
import { PLANS } from "@kaipu/domain/constants";
import { useLocale, useTranslations } from "@kaipu/i18n";
import * as stylex from "@stylexjs/stylex";
import { KaipuLogo } from "@kaipu/brand";
import { useAccountStorage } from "@/hooks/use-account-storage";
import { claimFirstVisit } from "@/lib/first-visit";
import { formatBytesForLocale } from "@/lib/format-bytes";
import { bp, kl } from "./dashboard.stylex";
import { Button, GlowBox } from "./ui";

/**
 * "Your account is ready", shown on the first dashboard visit of this user in this browser.
 *
 * The storage read happens after mount (the server render has no `localStorage`, and a read during
 * render would make the first client render disagree with the markup). It stays on screen until
 * dismissed or until the next visit; it is never shown again for the same user. The plan line
 * only appears when the plan loaded: a failed request is the storage card's job to explain.
 *
 * `onVisibleChange` tells the home whether the welcome (and its fox) is on screen, so the
 * download card below can leave its own mark out: one fox per screen.
 */
export function FirstVisitWelcome({
  userId,
  onVisibleChange,
}: {
  userId: string;
  onVisibleChange?: (visible: boolean) => void;
}) {
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

  useEffect(() => {
    onVisibleChange?.(shown);
  }, [shown, onVisibleChange]);

  if (!shown) return null;

  const planLine =
    storage.view.kind === "usage" && storage.plan
      ? t("firstVisitPlan", {
          plan: ts(PLANS[storage.plan.plan].nameKey),
          capacity: formatBytesForLocale(storage.view.usage.capacityBytes, locale),
        })
      : null;

  return (
    <GlowBox accent>
      <div {...stylex.props(s.row)}>
        <KaipuLogo use="done" size={84} {...stylex.props(s.fox)} />
        <div {...stylex.props(s.body)}>
          <h2 {...stylex.props(s.title)}>{t("firstVisitTitle")}</h2>
          {planLine ? <p {...stylex.props(s.text)}>{planLine}</p> : null}
        </div>
        <Button variant="pink" size="lg" onClick={() => setShown(false)}>
          {t("firstVisitDismiss")}
        </Button>
      </div>
    </GlowBox>
  );
}

const s = stylex.create({
  row: {
    display: "flex",
    flexWrap: { default: "nowrap", [bp.mobile]: "wrap" },
    alignItems: "center",
    gap: { default: "22px", [bp.mobile]: "16px" },
    padding: { default: "26px", [bp.mobile]: "20px" },
  },
  fox: {
    flexShrink: 0,
    width: { default: "84px", [bp.mobile]: "64px" },
    height: { default: "84px", [bp.mobile]: "64px" },
    boxShadow: "0 20px 40px -18px rgba(246, 5, 92, 0.9)",
  },
  body: { flex: "1", minWidth: 0 },
  title: {
    margin: 0,
    fontSize: { default: "26px", [bp.mobile]: "22px" },
    fontWeight: 700,
    letterSpacing: "-0.035em",
    color: kl.tx,
  },
  text: { margin: 0, marginTop: "6px", fontSize: "15px", lineHeight: 1.5, color: kl.dim },
});
