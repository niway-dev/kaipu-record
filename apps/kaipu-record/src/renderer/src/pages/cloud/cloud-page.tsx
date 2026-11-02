import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { StorageCloudSettings } from "@renderer/features/storage-cloud/storage-cloud-settings";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import { OverrideBlock } from "@renderer/pages/settings/scope/scope-controls";
import { WorkspaceCloudSection } from "@renderer/features/workspaces/cloud/workspace-cloud-section";
import styles from "@renderer/features/storage-cloud/storage-cloud-settings.module.css";

/**
 * Rail section: cloud account, save mode and capacity, then the active workspace's cloud view
 * (where its folder lives, which Kaipu Cloud items its Library lists, the unassigned ones). The save mode is per device, and a
 * workspace may override it (ADR 0034): the consent stays on this Mac, keyed by workspace. The
 * bar above the page says whose value it is and carries Reset and Copy to all workspaces.
 */
export function CloudPage(): React.JSX.Element {
  const t = useTranslations("storageCloud");
  const { settings } = useAppSettings();
  return (
    <div className={styles.page}>
      <OverrideBlock settingKey="uploadMode" fallback="local-only" label={t("saveMode")}>
        {({ value, onChange }) => (
          <StorageCloudSettings
            // Until the first settings read the page shows its placeholders.
            uploadMode={settings ? value : null}
            onUploadModeChange={onChange}
          />
        )}
      </OverrideBlock>
      {/* Where this workspace lives, its cloud filter, and the unassigned cloud items. */}
      <WorkspaceCloudSection />
    </div>
  );
}
