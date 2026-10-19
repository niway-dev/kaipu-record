import { useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@kaipu/web-ui";
import { detectDesktopOs, type DesktopOs } from "@/lib/desktop-os";
import { downloadUrls } from "@/lib/download";

/**
 * Desktop download. The visitor's OS is read after mount (the server cannot know it), so the
 * first render, and any browser we cannot classify, shows every download as an equal button.
 */
export function GetStarted({ os: forcedOs }: { os?: DesktopOs } = {}) {
  const t = useTranslations("dashboard");
  const [detected, setDetected] = useState<DesktopOs>("other");

  useEffect(() => {
    setDetected(detectDesktopOs(navigator));
  }, []);

  const os = forcedOs ?? detected;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("getStartedTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">{t("getStartedBody")}</p>
        {os === "mac" && (
          <Downloads
            primary={{ href: downloadUrls.macArm64, label: t("downloadMac") }}
            others={[
              { href: downloadUrls.macX64, label: t("downloadMacIntel") },
              { href: downloadUrls.windowsX64, label: t("downloadWindowsShort") },
            ]}
            othersLabel={t("otherDownloads")}
          />
        )}
        {os === "windows" && (
          <Downloads
            primary={{ href: downloadUrls.windowsX64, label: t("downloadWindows") }}
            others={[
              { href: downloadUrls.macArm64, label: t("downloadMacShort") },
              { href: downloadUrls.macX64, label: t("downloadMacIntel") },
            ]}
            othersLabel={t("otherDownloads")}
          />
        )}
        {os === "other" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<a href={downloadUrls.macArm64} />}>
              {t("downloadMacShort")}
            </Button>
            <Button variant="outline" render={<a href={downloadUrls.macX64} />}>
              {t("downloadMacIntel")}
            </Button>
            <Button variant="outline" render={<a href={downloadUrls.windowsX64} />}>
              {t("downloadWindowsShort")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Link {
  href: string;
  label: string;
}

function Downloads({
  primary,
  others,
  othersLabel,
}: {
  primary: Link;
  others: Link[];
  othersLabel: string;
}) {
  return (
    <div className="space-y-2">
      <Button render={<a href={primary.href} />}>{primary.label}</Button>
      <p className="text-muted-foreground text-sm">
        {othersLabel}:{" "}
        {others.map((link, i) => (
          <span key={link.href}>
            {i > 0 && " · "}
            <a href={link.href} className="text-primary hover:underline">
              {link.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
