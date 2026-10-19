import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import {
  CreditCard,
  House,
  LibraryBig,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { SUPPORTED_LOCALES, useLocale, useSetLocale, useTranslations } from "@kaipu/i18n";

import type { LandingTheme } from "@/lib/landing-theme";
import { greetingName } from "./welcome-section";
import { bp, kl } from "./dashboard.stylex";
import { Button, Card, IconButton } from "./ui";
import "@/styles/landing-fonts.css";
import "@/styles/landing-tokens.css";

/**
 * The signed-in area's frame (design: "Kaipu Dashboard.dc.html"): a 240px sidebar on desktop;
 * on a phone a compact top bar and a four-item bottom tab bar with 44px targets.
 *
 * It draws with the landing's palette (`[data-kl]` + `data-kl-theme`, the same cookie the home
 * and the sign-in pages use), so a visitor who picked light anywhere sees light here too.
 *
 * This is the view: the theme, the current path and the actions arrive as props, so it renders
 * in a test without a router. `DashboardLayout` (routes/_authenticated/dashboard.tsx) wires it.
 */

const NAV = [
  { to: "/dashboard", key: "navHome", icon: House, exact: true },
  { to: "/dashboard/recordings", key: "navRecordings", icon: LibraryBig, exact: false },
  { to: "/dashboard/profile", key: "navProfile", icon: UserRound, exact: false },
  { to: "/dashboard/settings", key: "navSettings", icon: Settings, exact: false },
] as const;

const SOON = [
  { key: "navDevices", icon: Monitor },
  { key: "navBilling", icon: CreditCard },
] as const;

export interface DashboardShellProps {
  user: { name: string; email: string };
  pathname: string;
  theme: LandingTheme;
  onToggleTheme: () => void;
  onSignOut: () => void;
  signingOut?: boolean;
  children: ReactNode;
}

function isActive(pathname: string, to: string, exact: boolean): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return exact ? path === to : path === to || path.startsWith(`${to}/`);
}

export function DashboardShell({
  user,
  pathname,
  theme,
  onToggleTheme,
  onSignOut,
  signingOut = false,
  children,
}: DashboardShellProps) {
  const t = useTranslations("dashboard");
  const displayName = greetingName(user);
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div data-kl data-kl-theme={theme} {...stylex.props(s.page)}>
      <nav aria-label={t("navLabel")} {...stylex.props(s.sidebar)}>
        <Link to="/dashboard" {...stylex.props(s.brand)}>
          <KaipuLogo use="product" size={30} />
          Kaipu
        </Link>
        <ul {...stylex.props(s.list)}>
          {NAV.map((item) => {
            const active = isActive(pathname, item.to, item.exact);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.exact }}
                  aria-current={active ? "page" : undefined}
                  {...stylex.props(s.item, active && s.itemActive)}
                >
                  {active ? <span aria-hidden {...stylex.props(s.marker)} /> : null}
                  <span {...stylex.props(s.itemIcon, active && s.itemIconActive)}>
                    <Icon size={17} strokeWidth={1.8} aria-hidden />
                  </span>
                  {t(item.key)}
                </Link>
              </li>
            );
          })}
        </ul>
        <div aria-hidden {...stylex.props(s.divider)} />
        <ul {...stylex.props(s.list)}>
          {SOON.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.key}
                aria-disabled="true"
                title={t("comingSoon")}
                {...stylex.props(s.soonItem)}
              >
                <Icon size={17} strokeWidth={1.8} aria-hidden />
                <span {...stylex.props(s.soonLabel)}>{t(item.key)}</span>
                <span {...stylex.props(s.soonTag)}>{t("navSoon")}</span>
              </li>
            );
          })}
        </ul>
        <div {...stylex.props(s.grow)} />
        <div {...stylex.props(s.userRow)}>
          <span aria-hidden {...stylex.props(s.avatar)}>
            {initial}
          </span>
          <div {...stylex.props(s.userText)}>
            <p {...stylex.props(s.userName)}>{displayName}</p>
            <p {...stylex.props(s.userEmail)}>{user.email}</p>
          </div>
        </div>
        <div {...stylex.props(s.controls)}>
          <ThemeButton theme={theme} onToggle={onToggleTheme} />
          <LocaleToggle />
          <span {...stylex.props(s.grow)} />
          <IconButton label={t("signOut")} onClick={onSignOut} disabled={signingOut}>
            <LogOut size={15} aria-hidden />
          </IconButton>
        </div>
      </nav>

      <div {...stylex.props(s.column)}>
        <header {...stylex.props(s.mobileTop)}>
          <Link to="/dashboard" {...stylex.props(s.mobileBrand)}>
            <KaipuLogo use="product" size={28} />
            Kaipu
          </Link>
          <span aria-hidden {...stylex.props(s.avatar, s.avatarSmall)}>
            {initial}
          </span>
        </header>
        <main {...stylex.props(s.main)}>
          <div {...stylex.props(s.content)}>{children}</div>
        </main>
      </div>

      <nav aria-label={t("navLabel")} {...stylex.props(s.bottomBar)}>
        {NAV.map((item) => {
          const active = isActive(pathname, item.to, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              aria-current={active ? "page" : undefined}
              {...stylex.props(s.tab, active && s.tabActive)}
            >
              <Icon size={19} strokeWidth={1.8} aria-hidden />
              <span {...stylex.props(s.tabLabel)}>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Sun/moon: the icon shows the theme you would get, like the home's and sign-in's switches. */
export function ThemeButton({ theme, onToggle }: { theme: LandingTheme; onToggle: () => void }) {
  const t = useTranslations("dashboard");
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton label={next === "light" ? t("themeToLight") : t("themeToDark")} onClick={onToggle}>
      {next === "light" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </IconButton>
  );
}

/**
 * The phone's stand-in for the sidebar's foot: the theme switch and Sign out, in a card at the
 * end of Settings (language has its own card there).
 */
export function AccountControls({
  theme,
  onToggleTheme,
  onSignOut,
  signingOut = false,
}: {
  theme: LandingTheme;
  onToggleTheme: () => void;
  onSignOut: () => void;
  signingOut?: boolean;
}) {
  const t = useTranslations("dashboard");
  return (
    <Card>
      <div {...stylex.props(s.controls)}>
        <ThemeButton theme={theme} onToggle={onToggleTheme} />
        <span {...stylex.props(s.grow)} />
        <Button
          size="lg"
          icon={<LogOut size={15} aria-hidden />}
          onClick={onSignOut}
          disabled={signingOut}
        >
          {t("signOut")}
        </Button>
      </div>
    </Card>
  );
}

function LocaleToggle() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div role="group" aria-label={t("languageTitle")} {...stylex.props(s.locale)}>
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

const s = stylex.create({
  page: {
    display: "flex",
    minHeight: "100svh",
    backgroundColor: kl.bg,
    color: kl.tx,
    fontFamily: kl.fontSans,
    WebkitFontSmoothing: "antialiased",
  },
  sidebar: {
    position: "sticky",
    top: 0,
    display: { default: "flex", [bp.mobile]: "none" },
    flexDirection: "column",
    flexShrink: 0,
    boxSizing: "border-box",
    width: "240px",
    height: "100svh",
    paddingBlock: "20px 16px",
    paddingInline: "24px 14px",
    overflowY: "auto",
    backgroundColor: kl.bg2,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: kl.bd,
  },
  brand: {
    ...focusRing,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "26px",
    paddingLeft: "2px",
    borderRadius: "8px",
    color: kl.tx,
    fontSize: "17px",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    textDecoration: "none",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: {
    ...focusRing,
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "11px",
    minHeight: "40px",
    paddingInline: "12px",
    borderRadius: "10px",
    backgroundColor: { default: "transparent", ":hover": kl.card2 },
    color: kl.dim,
    fontSize: "14px",
    fontWeight: 600,
    textDecoration: "none",
  },
  itemActive: { backgroundColor: kl.card2, color: kl.tx },
  marker: {
    position: "absolute",
    left: "-12px",
    top: "10px",
    bottom: "10px",
    width: "3px",
    borderRadius: "2px",
    backgroundColor: kl.pink,
  },
  itemIcon: { display: "flex", color: kl.faint },
  itemIconActive: { color: kl.pinkTx },
  divider: { height: "1px", marginBlock: "14px", backgroundColor: kl.bd },
  soonItem: {
    display: "flex",
    alignItems: "center",
    gap: "11px",
    minHeight: "40px",
    paddingInline: "12px",
    color: kl.faint,
    fontSize: "14px",
    fontWeight: 500,
    cursor: "default",
  },
  soonTag: {
    fontFamily: kl.fontMono,
    fontSize: "9px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  grow: { flex: "1", minWidth: 0 },
  soonLabel: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  userRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    paddingBlock: "12px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: kl.bd,
  },
  avatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    backgroundColor: "#7c4dff",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
  },
  avatarSmall: { width: "30px", height: "30px", fontSize: "12px" },
  userText: { minWidth: 0 },
  userName: {
    margin: 0,
    overflow: "hidden",
    color: kl.tx,
    fontSize: "13.5px",
    fontWeight: 600,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  userEmail: {
    margin: 0,
    overflow: "hidden",
    color: kl.faint,
    fontFamily: kl.fontMono,
    fontSize: "10.5px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  controls: { display: "flex", alignItems: "center", gap: "8px" },
  locale: {
    display: "flex",
    gap: "2px",
    padding: "2px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "8px",
  },
  localeOption: {
    ...focusRing,
    height: "30px",
    paddingInline: "9px",
    borderStyle: "none",
    borderRadius: "6px",
    backgroundColor: "transparent",
    color: kl.faint,
    fontFamily: kl.fontMono,
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
  },
  localeActive: { backgroundColor: kl.card2, color: kl.tx },
  column: { display: "flex", flexDirection: "column", flex: "1", minWidth: 0 },
  mobileTop: {
    display: { default: "none", [bp.mobile]: "flex" },
    alignItems: "center",
    gap: "9px",
    paddingBlock: "14px",
    paddingInline: "16px",
    backgroundColor: kl.bg,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: kl.bd,
  },
  mobileBrand: {
    ...focusRing,
    display: "flex",
    alignItems: "center",
    gap: "9px",
    flex: "1",
    borderRadius: "8px",
    color: kl.tx,
    fontSize: "16px",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    textDecoration: "none",
  },
  main: { flex: "1", minWidth: 0 },
  content: {
    boxSizing: "border-box",
    maxWidth: "880px",
    marginInline: "auto",
    paddingBlock: { default: "40px 56px", [bp.mobile]: "22px 104px" },
    paddingInline: { default: "48px", [bp.mobile]: "16px" },
  },
  bottomBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    display: { default: "none", [bp.mobile]: "flex" },
    paddingTop: "6px",
    paddingInline: "6px",
    paddingBottom: "max(10px, env(safe-area-inset-bottom))",
    backgroundColor: kl.bg2,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: kl.bd,
  },
  tab: {
    ...focusRing,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    flex: "1",
    minWidth: 0,
    minHeight: "52px",
    borderRadius: "10px",
    color: kl.faint,
    textDecoration: "none",
  },
  tabActive: { color: kl.pinkTx },
  tabLabel: {
    maxWidth: "100%",
    fontSize: "11px",
    fontWeight: 600,
    lineHeight: 1.2,
    textAlign: "center",
    overflowWrap: "anywhere",
  },
});
