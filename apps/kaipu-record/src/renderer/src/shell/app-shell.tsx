import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import {
  useVersionGate,
  VersionGateOverlay,
  VersionGateBanner,
} from "@renderer/features/version-gate";
import { useUpdateStatus, UpdateBanner } from "@renderer/features/updater";
import { useAppVersion } from "./use-app-version";
import styles from "./app-shell.module.css";

/**
 * App layout: a fixed icon sidebar plus the active page rendered into <Outlet />,
 * with a status bar showing the real (global, rebindable) recording shortcuts.
 * Every page lives under this shell (see app/router.tsx).
 */
export function AppShell(): React.JSX.Element {
  const navigate = useNavigate();
  const shortcuts = useShortcutLabels();
  const gate = useVersionGate();
  const update = useUpdateStatus();
  const version = useAppVersion();

  // A global "start recording" (the hotkey or the Capture Panel) can arrive on any
  // route — the recorder lives on the Record page, so bring the user there and
  // flag an auto-start. The Record page reads the flag and starts. Lives here (not
  // on the Record page) so it works even when another page is showing.
  useEffect(
    () =>
      window.electronAPI.onRequestStartRecording(() => {
        navigate("/", { state: { startAt: Date.now() } });
      }),
    [navigate],
  );

  return (
    <div className={styles.shell}>
      {gate.kind === "soft" && (
        <VersionGateBanner message={gate.message} downloadUrl={gate.downloadUrl} />
      )}
      {update.state === "ready" && <UpdateBanner version={update.version} />}
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
      <div className={styles.statusBar}>
        {shortcuts && (
          <>
            <span>
              <kbd>{shortcuts.startRecording}</kbd> start
            </span>
            <span className={styles.statusDot}>·</span>
            <span>
              <kbd>{shortcuts.stopRecording}</kbd> stop
            </span>
            <span className={styles.statusDot}>·</span>
            <span>
              <kbd>{shortcuts.bringToFront}</kbd> show app
            </span>
          </>
        )}
        {version && <span className={styles.statusVersion}>v{version}</span>}
      </div>
      {gate.kind === "hard" && (
        <VersionGateOverlay message={gate.message} downloadUrl={gate.downloadUrl} />
      )}
    </div>
  );
}
