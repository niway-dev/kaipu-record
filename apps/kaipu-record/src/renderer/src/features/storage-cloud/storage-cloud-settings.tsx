import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { UploadMode } from "@shared/types";
import { Card } from "@renderer/ui/card";
import { AccountPanel } from "@renderer/features/auth/account-panel";
import { useAuthStatus } from "@renderer/features/auth/use-auth-status";
import { CapacityCard } from "./capacity-card";
import { toCapacityView } from "./capacity-view";
import {
  simulatedAuthStatus,
  simulatedStorageResult,
  useStorageSimulator,
} from "./dev-storage-simulator";
import { UploadModePicker } from "./upload-mode-picker";
import { useStorageUsage } from "./use-storage-usage";
import styles from "./storage-cloud-settings.module.css";

export interface StorageCloudSettingsProps {
  uploadMode: UploadMode | null;
  onUploadModeChange(mode: UploadMode): void;
}

/**
 * The Cloud page body (design handoff §1): the per-device save mode and the account with its
 * cloud capacity. The local folder lives in Settings → Files. Local keeps working without an
 * account.
 */
export function StorageCloudSettings({
  uploadMode,
  onUploadModeChange,
}: StorageCloudSettingsProps): React.JSX.Element {
  const t = useTranslations("storageCloud");
  const auth = useAuthStatus();
  const sim = useStorageSimulator();

  const status = simulatedAuthStatus(auth.status, sim);
  const simulatedResult = simulatedStorageResult(sim, Date.now());
  const accountKey =
    status.kind === "signed-in"
      ? status.userId
      : status.kind === "unknown"
        ? (status.lastKnownUserId ?? "unknown")
        : null;
  const usage = useStorageUsage(accountKey, simulatedResult === undefined && accountKey !== null);
  const view = toCapacityView(simulatedResult === undefined ? usage.result : simulatedResult);
  const hasAccount = status.kind === "signed-in" || status.kind === "unknown";

  return (
    <section className={styles.group} aria-labelledby="storage-cloud-title">
      <div className={styles.groupHeader}>
        <h1 id="storage-cloud-title" className={styles.groupTitle}>
          {t("title")}
        </h1>
        <p className={styles.groupDescription}>{t("description")}</p>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>{t("saveMode")}</h3>
        <UploadModePicker
          mode={uploadMode}
          cloudAvailable={hasAccount}
          onChange={onUploadModeChange}
        />
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>{t("accountAndCapacity")}</h3>
        <Card>
          {status.kind === "signed-in" || status.kind === "unknown" ? (
            <CapacityCard
              status={status}
              view={view}
              refreshing={usage.refreshing}
              onRefresh={() => void usage.refresh()}
              onSignOut={() => void auth.signOut()}
            />
          ) : (
            <AccountPanel statusOverride={sim.account === "real" ? undefined : status} />
          )}
        </Card>
      </div>
    </section>
  );
}
