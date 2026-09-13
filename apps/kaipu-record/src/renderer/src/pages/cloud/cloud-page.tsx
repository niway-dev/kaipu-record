import React from "react";
import { StorageCloudSettings } from "@renderer/features/storage-cloud/storage-cloud-settings";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import styles from "@renderer/features/storage-cloud/storage-cloud-settings.module.css";

/** Rail section: cloud account, per-device save mode and capacity. */
export function CloudPage(): React.JSX.Element {
  const { settings, update } = useAppSettings();
  return (
    <div className={styles.page}>
      <StorageCloudSettings
        uploadMode={settings?.uploadMode ?? null}
        onUploadModeChange={(uploadMode) => void update({ uploadMode })}
      />
    </div>
  );
}
