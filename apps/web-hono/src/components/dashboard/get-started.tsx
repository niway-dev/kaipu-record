import { useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@kaipu/web-ui";
import { detectDesktopOs, type DesktopOs } from "@/lib/desktop-os";
import { downloadUrls } from "@/lib/download";

type DownloadKey =
  | "downloadMac"
  | "downloadWindows"
  | "macAppleSilicon"
  | "macIntel"
  | "windowsBeta";

interface Download {
  label: DownloadKey;
  href: string;
}

const MAC: Download = { label: "downloadMac", href: downloadUrls.macArm64 };
const WINDOWS: Download = { label: "downloadWindows", href: downloadUrls.windowsX64 };
const MAC_ARM: Download = { label: "macAppleSilicon", href: downloadUrls.macArm64 };
const MAC_INTEL: Download = { label: "macIntel", href: downloadUrls.macX64 };
const WINDOWS_BETA: Download = { label: "windowsBeta", href: downloadUrls.windowsX64 };

/** The primary button (if the visitor's OS is known) and the plain links for everything else. */
export function downloadsFor(os: DesktopOs): { primary: Download | null; others: Download[] } {
  switch (os) {
    case "mac":
      return { primary: MAC, others: [MAC_INTEL, WINDOWS_BETA] };
    case "windows":
      return { primary: WINDOWS, others: [MAC_ARM, MAC_INTEL] };
    case "other":
      return { primary: null, others: [MAC_ARM, MAC_INTEL, WINDOWS_BETA] };
  }
}

/**
 * Shown to every user until the online library exists (NIW2-221): recording happens in the desktop
 * app, so the first thing a new account needs is the installer.
 */
export function GetStarted() {
  const t = useTranslations("dashboard");
  // "other" on the server and on the first client render, then the real answer: the user agent is
  // not known on the server, and reading it during render would break hydration.
  const [os, setOs] = useState<DesktopOs>("other");
  useEffect(() => {
    setOs(detectDesktopOs(navigator));
  }, []);

  const { primary, others } = downloadsFor(os);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("getStartedTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("getStartedDetail")}</p>
        {primary && <Button render={<a href={primary.href} />}>{t(primary.label)}</Button>}
        <div className="space-y-1">
          {primary && <p className="text-muted-foreground text-xs">{t("otherDownloads")}</p>}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {others.map((item) => (
              <li key={item.label}>
                <a href={item.href} className="text-primary hover:underline">
                  {t(item.label)}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground text-sm">{t("uploadHint")}</p>
      </CardContent>
    </Card>
  );
}
