import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { WorkspaceView } from "@shared/types/workspaces";
import { WorkspaceTile } from "@renderer/features/workspaces/workspace-switcher";
import { uiArea } from "@renderer/lib/ui-area";
import styles from "./panel-footer.module.css";

interface PanelFooterProps {
  /** The workspace the next take lands in; hidden until it is known. */
  workspace: WorkspaceView | null;
  /** Shows the main window, where the title bar switches workspace. */
  onOpenWorkspace(): void;
  /** Shows the main window on the Capture page. */
  onOpenSetup(): void;
}

/** Tray popover footer: where the take lands, and the way to the Capture page's setup. */
export function PanelFooter({
  workspace,
  onOpenWorkspace,
  onOpenSetup,
}: PanelFooterProps): React.JSX.Element {
  const t = useTranslations("panel");
  return (
    <div {...uiArea("capturePanel.footer")} className={styles.footer}>
      {workspace && (
        <button type="button" className={styles.workspace} onClick={onOpenWorkspace}>
          <WorkspaceTile workspace={workspace} size={16} />
          <span className={styles.name}>{workspace.name}</span>
        </button>
      )}
      <button type="button" className={styles.setup} onClick={onOpenSetup}>
        {t("setup")}
      </button>
    </div>
  );
}
