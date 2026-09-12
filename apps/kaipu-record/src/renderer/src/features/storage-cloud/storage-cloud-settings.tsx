import React from "react";
import { Folder } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { UploadMode } from "@shared/types";
import { Card } from "@renderer/ui/card";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";
import { AccountPanel } from "@renderer/features/auth/account-panel";
import { useAuthStatus } from "@renderer/features/auth/use-auth-status";
import { useVaultDirectory } from "@renderer/features/library/hooks/use-vault-directory";
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
 * Settings → Storage and cloud (design handoff §1): the local folder, the per-device save
 * mode, and the account with its cloud capacity. Local keeps working without an account.
 */
export function StorageCloudSettings({
  uploadMode,
  onUploadModeChange,
}: StorageCloudSettingsProps): React.JSX.Element {
  const t = useTranslations("storageCloud");
  const ts = useTranslations("settings");
  const vault = useVaultDirectory();
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
        <h2 id="storage-cloud-title" className={styles.groupTitle}>
          {t("title")}
        </h2>
        <p className={styles.groupDescription}>{t("description")}</p>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>{t("localFolder")}</h3>
        <Card>
          <Row
            icon={
              <span className={styles.folderIcon}>
                <Folder size={16} />
              </span>
            }
            label={vault.directory ? (vault.directory.path.split(/[\\/]/).pop() ?? "") : ""}
            description={
              <span className={styles.pathValue} title={vault.directory?.path}>
                {vault.directory
                  ? `${vault.directory.path} · ${vault.directory.isCustom ? ts("folderCustom") : ts("folderDefault")}`
                  : ts("folderLoading")}
              </span>
            }
            action={
              <>
                {vault.directory?.isCustom && (
                  <Button variant="ghost" size="sm" onClick={() => void vault.reset()}>
                    {ts("reset")}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void vault.choose()}>
                  {t("change")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void window.electronAPI.openVaultDirectory()}
                >
                  {t("openFolder")}
                </Button>
              </>
            }
          />
        </Card>
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
