import React, { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { SHORTCUT_DEFINITIONS } from "@shared/types";
import { Sidebar } from "./sidebar";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { subscribeRecordingComplete } from "@renderer/features/recording/recorder-store";
import {
  useVersionGate,
  VersionGateOverlay,
  VersionGateBanner,
} from "@renderer/features/version-gate";
import { useUpdateStatus, UpdateBanner } from "@renderer/features/updater";
import { useAppVersion } from "./use-app-version";
import { useScreenshotCapture } from "@renderer/features/screenshots/use-screenshot-capture";
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
  const { capture } = useScreenshotCapture();

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

  // The Capture Panel's "Change" opens the screen picker, which lives on the Record
  // page — navigate there with an `openPicker` flag the Record page reads.
  useEffect(
    () =>
      window.electronAPI.onRequestChooseSource(() => {
        navigate("/", { state: { openPicker: Date.now() } });
      }),
    [navigate],
  );

  // Global ⌘⌃X hotkey: main brings the window to front and broadcasts this event;
  // we run the region-capture flow here so navigation (useNavigate) is available.
  useEffect(() => window.electronAPI.onCaptureScreenshotHotkey(capture), [capture]);

  // A recording finishing is reported by the module-singleton recorder store
  // (see recorder-store.ts), not by whichever page happens to be mounted — the
  // engine can outlive the Record page (navigation, screenshot detour, the
  // bringToFront rescue). Subscribing here, on the shell that never unmounts
  // across route changes, lands the navigation reliably every time.
  useEffect(
    () => subscribeRecordingComplete((recording) => navigate(`/library/${recording.id}`)),
    [navigate],
  );

  // Signal main that our IPC listeners (above) are registered — LAST effect, so
  // it runs after them. Main defers window-triggered actions (start/capture/
  // source-picker sent to a freshly-created window) until this fires, so they're
  // never dropped by racing the listeners against the page's did-finish-load.
  useEffect(() => window.electronAPI.notifyReady(), []);

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
        {shortcuts &&
          SHORTCUT_DEFINITIONS.map((def, i) => (
            <React.Fragment key={def.action}>
              {i > 0 && <span className={styles.statusDot}>·</span>}
              <span>
                <kbd>{shortcuts[def.action]}</kbd> {def.statusWord}
              </span>
            </React.Fragment>
          ))}
        {version && <span className={styles.statusVersion}>v{version}</span>}
      </div>
      {gate.kind === "hard" && (
        <VersionGateOverlay message={gate.message} downloadUrl={gate.downloadUrl} />
      )}
    </div>
  );
}
