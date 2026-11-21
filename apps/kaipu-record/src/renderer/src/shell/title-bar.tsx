import React, { useContext } from "react";
import { KaipuLogo } from "@kaipu/brand";
import { WorkspaceSwitcher } from "@renderer/features/workspaces/workspace-switcher";
import {
  setHeaderActionsElement,
  setHeaderEndElement,
} from "@renderer/features/workspaces/header-slot";
import { useOptionalWorkspaces } from "@renderer/features/workspaces/workspaces-context";
import { hostPlatform } from "@renderer/features/shortcuts/host-platform";
import { OnboardingContext } from "@renderer/features/onboarding/onboarding-context";
import { HistoryArrows } from "./history-arrows";
import styles from "./title-bar.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/**
 * The main window's title bar (NIW2-621), drawn by us in the space main frees with
 * `titleBarStyle` (see main/window-chrome.ts):
 *
 * - macOS: traffic lights · logo · ‹ › · "Kaipu Record" · workspace switcher … page actions · item chip
 * - Windows / Linux: logo · ‹ › · "Kaipu Record" · workspace switcher … page actions · item chip ·
 *   native caption buttons
 *
 * The OS draws its controls over this bar, so the bar only leaves their side empty: a fixed
 * inset for the traffic lights, `env(titlebar-area-*)` for the Windows overlay. The bar drags
 * the window; anything clickable in it opts out with `no-drag`.
 *
 * `workspace` is false where there is no workspace to switch (the sign-in page, the error
 * screen); the bar still draws, so the window keeps a handle to drag it by. Onboarding sits
 * below the bar and hides the switcher too: its menu would open under the takeover. The
 * history arrows follow the same rule: nothing to go back to on sign-in, and a page change
 * under the takeover would be invisible. They stay mounted while hidden, so the history
 * position they track sees every navigation.
 */
export function TitleBar({ workspace = true }: { workspace?: boolean }): React.JSX.Element {
  const workspaces = useOptionalWorkspaces();
  const onboarding = useContext(OnboardingContext)?.isOpen ?? false;
  const showSwitcher = workspace && workspaces !== null && !onboarding;
  const showHistory = workspace && !onboarding;
  return (
    <header {...uiArea("shell.titleBar")} className={styles.bar} data-platform={hostPlatform()}>
      <KaipuLogo use="product" size={28} />
      <HistoryArrows hidden={!showHistory} />
      <span className={styles.name}>Kaipu Record</span>
      {/* This process runs in Admin mode (ADR 0067): fixed at launch, so it never flickers. */}
      {window.electronAPI.adminMode && <span className={styles.adminBadge}>👑 Admin</span>}
      {showSwitcher && (
        <>
          <span className={styles.separator} aria-hidden>
            /
          </span>
          <div className={styles.interactive}>
            <WorkspaceSwitcher />
          </div>
          {/* A page's own actions, right-aligned (the video editor's, NIW2-619), then the
              "IN · Work ▾" chip of a page that belongs to an item (header-slot). */}
          <div
            className={`${styles.actions} ${styles.interactive}`}
            ref={setHeaderActionsElement}
          />
          <div className={`${styles.end} ${styles.interactive}`} ref={setHeaderEndElement} />
        </>
      )}
    </header>
  );
}
