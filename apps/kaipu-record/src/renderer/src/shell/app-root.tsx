import React, { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { subscribeRecordingComplete } from "@renderer/features/recording/recorder-store";
import {
  useVersionGate,
  VersionGateOverlay,
  VersionGateBanner,
} from "@renderer/features/version-gate";
import { useUpdateStatus, UpdateBanner } from "@renderer/features/updater";
import { useScreenshotCapture } from "@renderer/features/screenshots/use-screenshot-capture";
import styles from "./app-root.module.css";

/**
 * Root layout route: everything that must stay mounted on EVERY route, whatever chrome
 * the route draws. AppShell (sidebar + status bar) and the full-window auth pages are
 * its children (see app/router.tsx), so a hotkey, a finishing recording or a version
 * gate keeps working while the user is on a page without the sidebar.
 */
export function AppRoot(): React.JSX.Element {
  const navigate = useNavigate();
  const gate = useVersionGate();
  const update = useUpdateStatus();
  const { capture } = useScreenshotCapture();

  // A global "start recording" (the hotkey or the Capture Panel) can arrive on any
  // route — the recorder lives on the Record page, so bring the user there and
  // flag an auto-start. The Record page reads the flag and starts.
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
  // bringToFront rescue). Subscribing here, on a layout that never unmounts
  // across route changes, lands the navigation reliably every time.
  useEffect(
    () =>
      subscribeRecordingComplete((recording) =>
        // `fromRecording` lets the detail page tell a post-record vault race (the
        // item can momentarily lag the navigation) apart from a genuinely stale
        // URL — see use-missing-recording-recovery.
        navigate(`/library/${recording.id}`, { state: { fromRecording: true } }),
      ),
    [navigate],
  );

  // Signal main that our IPC listeners (above) are registered — LAST effect, so
  // it runs after them. Main defers window-triggered actions (start/capture/
  // source-picker sent to a freshly-created window) until this fires, so they're
  // never dropped by racing the listeners against the page's did-finish-load.
  useEffect(() => window.electronAPI.notifyReady(), []);

  return (
    <div className={styles.root}>
      {gate.kind === "soft" && (
        <VersionGateBanner message={gate.message} downloadUrl={gate.downloadUrl} />
      )}
      {update.state === "ready" && <UpdateBanner version={update.version} />}
      <Outlet />
      {gate.kind === "hard" && (
        <VersionGateOverlay message={gate.message} downloadUrl={gate.downloadUrl} />
      )}
    </div>
  );
}
