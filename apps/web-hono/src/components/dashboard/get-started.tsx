import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Monitor } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";
import { detectDesktopOs, type DesktopOs } from "@/lib/desktop-os";
import { downloadUrls } from "@/lib/download";
import { bp, kl, tone } from "./dashboard.stylex";
import { AppleMark, GlowBox, WindowsMark, buttonProps, textLinkProps } from "./ui";

/**
 * Desktop download. The visitor's OS is read after mount (the server cannot know it), so the
 * first render, and any browser we cannot classify, shows every download as an equal button.
 *
 * `withMark` puts the app icon in the card; the home leaves it out on the first visit, where the
 * welcome above already shows the fox (one fox per screen).
 */
export function GetStarted({
  os: forcedOs,
  withMark = true,
}: { os?: DesktopOs; withMark?: boolean } = {}) {
  const t = useTranslations("dashboard");
  const [detected, setDetected] = useState<DesktopOs>("other");

  useEffect(() => {
    setDetected(detectDesktopOs(navigator));
  }, []);

  const os = forcedOs ?? detected;

  return (
    <GlowBox>
      <div {...stylex.props(s.row)}>
        {withMark ? (
          <KaipuLogo use="app" size={64} {...stylex.props(s.mark)} />
        ) : (
          <span aria-hidden {...stylex.props(s.iconTile)}>
            <Monitor size={20} strokeWidth={1.8} />
          </span>
        )}
        <div {...stylex.props(s.body)}>
          <h2 {...stylex.props(s.title)}>{t("getStartedTitle")}</h2>
          <p {...stylex.props(s.text)}>{t("getStartedBody")}</p>
          {os === "mac" && (
            <Downloads
              primary={{
                href: downloadUrls.macArm64,
                label: t("downloadMac"),
                mark: <AppleMark />,
              }}
              others={[
                { href: downloadUrls.macX64, label: t("downloadMacIntel") },
                { href: downloadUrls.windowsX64, label: t("downloadWindowsShort") },
              ]}
              othersLabel={t("otherDownloads")}
            />
          )}
          {os === "windows" && (
            <Downloads
              primary={{
                href: downloadUrls.windowsX64,
                label: t("downloadWindows"),
                mark: <WindowsMark />,
              }}
              others={[
                { href: downloadUrls.macArm64, label: t("downloadMacShort") },
                { href: downloadUrls.macX64, label: t("downloadMacIntel") },
              ]}
              othersLabel={t("otherDownloads")}
            />
          )}
          {os === "other" && (
            <div {...stylex.props(s.equal)}>
              <a href={downloadUrls.macArm64} {...buttonProps({ size: "lg", wrap: true })}>
                <AppleMark />
                {t("downloadMacShort")}
              </a>
              <a href={downloadUrls.macX64} {...buttonProps({ size: "lg", wrap: true })}>
                <AppleMark />
                {t("downloadMacIntel")}
              </a>
              <a href={downloadUrls.windowsX64} {...buttonProps({ size: "lg", wrap: true })}>
                <WindowsMark />
                {t("downloadWindowsShort")}
              </a>
            </div>
          )}
        </div>
      </div>
    </GlowBox>
  );
}

interface DownloadLink {
  href: string;
  label: string;
  mark?: React.ReactNode;
}

function Downloads({
  primary,
  others,
  othersLabel,
}: {
  primary: DownloadLink;
  others: DownloadLink[];
  othersLabel: string;
}) {
  return (
    <div {...stylex.props(s.downloads)}>
      <a href={primary.href} {...buttonProps({ variant: "pink", size: "lg", wrap: true })}>
        {primary.mark}
        {primary.label}
      </a>
      <p {...stylex.props(s.others)}>
        {othersLabel}:{" "}
        {others.map((link, i) => (
          <span key={link.href}>
            {i > 0 && " · "}
            <a href={link.href} {...textLinkProps()}>
              {link.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}

const s = stylex.create({
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: "18px",
    padding: { default: "22px", [bp.mobile]: "18px" },
  },
  mark: {
    flexShrink: 0,
    width: { default: "64px", [bp.mobile]: "52px" },
    height: { default: "64px", [bp.mobile]: "52px" },
  },
  iconTile: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    backgroundColor: tone.pinkTint,
    color: kl.pinkTx,
  },
  body: { flex: "1", minWidth: 0 },
  title: { margin: 0, fontSize: "17px", fontWeight: 600, letterSpacing: "-0.015em", color: kl.tx },
  text: { margin: 0, marginTop: "5px", fontSize: "14px", lineHeight: 1.5, color: kl.dim },
  downloads: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "14px",
    marginTop: "18px",
  },
  others: { margin: 0, fontSize: "13px", color: kl.dim },
  equal: {
    display: { default: "flex", [bp.mobile]: "grid" },
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "16px",
  },
});
