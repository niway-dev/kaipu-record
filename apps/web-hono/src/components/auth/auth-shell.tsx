import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { Check, Moon, Sun } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { SUPPORTED_LOCALES, useLocale, useSetLocale, useTranslations } from "@kaipu/i18n";

import { AppToaster } from "@/components/app-toaster";
import { setLandingTheme } from "@/server-functions/set-landing-theme";
import { bp, kl } from "./auth.stylex";
import "@/styles/landing-fonts.css";
import "@/styles/landing-tokens.css";

/**
 * The page every `/auth/*` route renders into (design: "Kaipu Web Auth.dc.html"): the brand
 * panel on the left, the 520px form column on the right, one column on a phone.
 *
 * It is not the app shell: no app header, no legal footer. The legal links live in each form.
 * The colours are the landing's (`[data-kl]` + `data-kl-theme`, read from the same cookie the
 * home's switch writes), so a visitor who picked light on the home sees light here, and the switch
 * here changes the home too.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const { landingTheme } = useRouteContext({ from: "__root__" });
  return (
    <div data-kl data-kl-theme={landingTheme} {...stylex.props(s.page)}>
      <BrandPanel />
      <div {...stylex.props(s.formSide)}>
        <div {...stylex.props(s.topBar)}>
          <a href="/" {...stylex.props(s.mobileBrand)}>
            <KaipuLogo use="product" size={28} />
            Kaipu
          </a>
          <div {...stylex.props(s.controls)}>
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>
        <main {...stylex.props(s.formArea)}>
          <div {...stylex.props(s.formInner)}>{children}</div>
        </main>
      </div>
      <AppToaster />
    </div>
  );
}

function BrandPanel() {
  const t = useTranslations("auth");
  const points = [t("brandPointLinks"), t("brandPointLibrary"), t("brandPointFiles")];
  return (
    <aside {...stylex.props(s.brand)}>
      <div aria-hidden {...stylex.props(s.glow)} />
      <div aria-hidden {...stylex.props(s.dots)} />
      <a href="/" {...stylex.props(s.brandMark)}>
        <KaipuLogo use="product" size={32} />
        Kaipu
      </a>
      <div {...stylex.props(s.brandBody)}>
        <KaipuLogo use="app" size={120} {...stylex.props(s.brandFox)} />
        <p {...stylex.props(s.brandHeadline)}>{t("brandHeadline")}</p>
        <p {...stylex.props(s.brandSerif)}>{t("brandSerif")}</p>
        <ul {...stylex.props(s.points)}>
          {points.map((point) => (
            <li key={point} {...stylex.props(s.point)}>
              <span aria-hidden {...stylex.props(s.pointCheck)}>
                <Check size={13} strokeWidth={2.4} />
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>
      <p {...stylex.props(s.brandFooter)}>{t("brandFooter")}</p>
    </aside>
  );
}

function ThemeToggle() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { landingTheme } = useRouteContext({ from: "__root__" });
  const next = landingTheme === "dark" ? "light" : "dark";
  const toggle = async () => {
    await setLandingTheme({ data: next });
    await router.invalidate();
  };
  return (
    <button
      type="button"
      aria-label={next === "light" ? t("themeToLight") : t("themeToDark")}
      onClick={() => void toggle()}
      {...stylex.props(s.round)}
    >
      {/* The icon shows the theme you would get, like the home's switch. */}
      {next === "light" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}

function LocaleToggle() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div role="group" aria-label={t("localeGroup")} {...stylex.props(s.locale)}>
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={code === locale}
          onClick={() => setLocale(code)}
          {...stylex.props(s.localeOption, code === locale && s.localeActive)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

const focusRing = {
  outline: { default: "none", ":focus-visible": "2px solid #f6055c" },
  outlineOffset: "2px",
} as const;

const floatKeyframes = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-8px)" },
});

const s = stylex.create({
  page: {
    display: "flex",
    minHeight: "100svh",
    backgroundColor: kl.bg,
    color: kl.tx,
    fontFamily: kl.fontSans,
    WebkitFontSmoothing: "antialiased",
  },
  brand: {
    position: "relative",
    display: { default: "flex", [bp.mobile]: "none" },
    flexDirection: "column",
    flex: "1 1 0",
    minWidth: 0,
    overflow: "hidden",
    padding: "34px 44px",
    backgroundColor: kl.bg2,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: kl.bd,
  },
  glow: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "radial-gradient(60% 55% at 30% 40%, rgba(246, 5, 92, 0.22), transparent 70%), radial-gradient(45% 45% at 80% 90%, rgba(124, 77, 255, 0.14), transparent 70%)",
  },
  dots: {
    position: "absolute",
    inset: 0,
    backgroundImage: "radial-gradient(var(--kl-dot) 1px, transparent 1px)",
    backgroundSize: "22px 22px",
  },
  brandMark: {
    ...focusRing,
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: "10px",
    color: kl.tx,
    fontSize: "17px",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    textDecoration: "none",
  },
  brandBody: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flex: 1,
    paddingBlock: "32px",
  },
  brandFox: {
    boxShadow: "0 30px 60px -22px rgba(246, 5, 92, 0.9)",
    animationName: { default: floatKeyframes, [bp.reducedMotion]: "none" },
    animationDuration: "5s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  brandHeadline: {
    margin: 0,
    marginTop: "34px",
    fontSize: "54px",
    fontWeight: 700,
    letterSpacing: "-0.055em",
    lineHeight: 0.95,
    color: kl.tx,
  },
  brandSerif: {
    margin: 0,
    marginTop: "6px",
    fontFamily: kl.fontSerif,
    fontStyle: "italic",
    fontSize: "38px",
    lineHeight: 1.05,
    color: kl.pinkTx,
  },
  points: {
    display: "flex",
    flexDirection: "column",
    gap: "11px",
    margin: 0,
    marginTop: "30px",
    padding: 0,
    listStyle: "none",
  },
  point: { display: "flex", alignItems: "center", gap: "11px", fontSize: "15px", color: kl.tx },
  pointCheck: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "24px",
    height: "24px",
    borderRadius: "7px",
    backgroundColor: "rgba(246, 5, 92, 0.14)",
    color: kl.pinkTx,
  },
  brandFooter: {
    position: "relative",
    margin: 0,
    fontFamily: kl.fontMono,
    fontSize: "11px",
    color: kl.faint,
  },
  formSide: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: { default: "0 0 520px", [bp.mobile]: "1 1 auto" },
    minWidth: 0,
    backgroundColor: kl.bg,
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: { default: "flex-end", [bp.mobile]: "space-between" },
    gap: "12px",
    padding: { default: "16px 18px 0", [bp.mobile]: "18px 20px 0" },
  },
  mobileBrand: {
    ...focusRing,
    display: { default: "none", [bp.mobile]: "inline-flex" },
    alignItems: "center",
    gap: "9px",
    color: kl.tx,
    fontSize: "16px",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    textDecoration: "none",
  },
  controls: { display: "flex", alignItems: "center", gap: "8px" },
  round: {
    ...focusRing,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd2,
    borderRadius: "999px",
    backgroundColor: "transparent",
    color: kl.tx,
    cursor: "pointer",
  },
  locale: {
    display: "flex",
    gap: "2px",
    padding: "3px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd2,
    borderRadius: "999px",
  },
  localeOption: {
    ...focusRing,
    height: "28px",
    paddingInline: "9px",
    borderStyle: "none",
    borderRadius: "999px",
    backgroundColor: "transparent",
    color: kl.dim,
    fontFamily: kl.fontMono,
    fontSize: "11px",
    cursor: "pointer",
  },
  localeActive: { backgroundColor: kl.card2, color: kl.tx },
  formArea: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    padding: { default: "40px 56px", [bp.mobile]: "28px 20px 30px" },
  },
  formInner: { width: "100%", maxWidth: "400px", color: kl.tx },
});
