import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";
import { useUpdateStatus } from "@renderer/features/updater";
import { useDevUpdateStatus } from "@renderer/features/updater/dev-update-simulator";
import type { UpdateStatus } from "@shared/types";

/** Only the variants that follow a COMPLETED check carry a timestamp. */
function checkedAtOf(status: UpdateStatus): number | null {
  if (status.state === "up-to-date" || status.state === "available" || status.state === "error") {
    return status.checkedAt;
  }
  return null;
}

/**
 * Which button belongs to a state, if any.
 *
 * `available` and `downloading` get none: `autoDownload` is on, so `available` is a
 * brief pass-through on the way to `downloading`, not something the user must act on.
 */
type Action = "check" | "install" | "retry" | "none";

function actionFor(status: UpdateStatus): Action {
  switch (status.state) {
    case "idle":
    case "up-to-date":
      return "check";
    case "ready":
      return "install";
    case "error":
      return "retry";
    case "checking":
    case "available":
    case "downloading":
      return "none";
  }
}

/**
 * Updates section: the installed version, what the updater is actually doing, and a
 * button to look now.
 *
 * There is deliberately NO switch to turn updates off. Owner's call: "I want a button
 * to look for changes, not to enable or disable updates — I don't want them disabled."
 * Automatic background updates stay mandatory.
 */
export function UpdateSettings(): React.JSX.Element {
  const t = useTranslations("updates");
  const status = useUpdateStatus();
  // In an unpackaged app the updater is inert, so the section would have nothing to
  // show — unless the Developer page is forcing a state, in which case the real rows
  // render it. That is the whole point of the simulator.
  const simulated = useDevUpdateStatus();
  const inertDevBuild = import.meta.env.DEV && simulated === null;
  const [version, setVersion] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void window.electronAPI.getAppVersion().then(setVersion);
  }, []);

  /** "checked just now" / "checked 5 min ago" / "checked 2 h ago". */
  const lastChecked = (at: number): string => {
    const minutes = Math.floor(Math.max(0, Date.now() - at) / 60_000);
    if (minutes < 1) return t("checkedJustNow");
    if (minutes < 60) return t("checkedMinutesAgo", { minutes });
    return t("checkedHoursAgo", { hours: Math.floor(minutes / 60) });
  };

  const message = (): string => {
    switch (status.state) {
      case "idle":
        return t("statusIdle");
      case "checking":
        return t("statusChecking");
      case "up-to-date":
        return t("statusUpToDate");
      case "available":
        return t("statusAvailable", { version: status.version });
      case "downloading":
        return t("statusDownloading", { version: status.version, percent: status.percent });
      case "ready":
        return t("statusReady", { version: status.version });
      case "error":
        return t("statusError", { reason: status.message });
    }
  };

  const check = (): void => {
    setBusy(true);
    void window.electronAPI.checkForUpdates().finally(() => setBusy(false));
  };

  const checkedAt = checkedAtOf(status);
  const action = actionFor(status);

  return (
    <>
      <Row
        label={t("version")}
        // The last-checked half is omitted rather than faked when the current state
        // carries no timestamp. Never a stale time.
        description={
          version === null
            ? ""
            : checkedAt === null
              ? version
              : `${version} · ${lastChecked(checkedAt)}`
        }
      />
      {inertDevBuild ? (
        // `initAutoUpdater` returns early when the app is not packaged, so a live
        // button here would be a no-op. Say so rather than let someone debug it.
        <Row label={t("status")} description={t("devDisabled")} />
      ) : (
        <Row
          label={t("status")}
          description={message()}
          action={
            action === "none" ? null : action === "install" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.electronAPI.installUpdate()}
              >
                {t("restartInstall")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={busy} onClick={check}>
                {t(action === "retry" ? "tryAgain" : "check")}
              </Button>
            )
          }
        />
      )}
    </>
  );
}
