import { FolderSync } from "lucide-react";
import { useTranslations, type Translator } from "@kaipu/i18n";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@kaipu/ui";
import type { ReconcileFinding, ReconcileScanResult } from "@shared/types/library-reconcile";
import {
  cancelWaiting,
  closeReconcileDialog,
  fixAll,
  openReconcileDialog,
  useReconcile,
  type ReconcileRun,
} from "./reconcile-store";
import styles from "./reconcile.module.css";

/** Rows rendered per list; a vault with hundreds of findings shows "…and N more". */
const MAX_ROWS = 200;

type LibraryT = Translator<"library">;

const fileName = (path: string): string => path.split("/").pop() ?? path;

/** One finding in plain language: current name → new name, or what happens to it. */
export function describeFinding(finding: ReconcileFinding, t: LibraryT): string {
  const path = finding.path;
  const name = finding.title || fileName(path);
  switch (finding.kind) {
    case "stale-auto-title":
    case "untitled-legacy":
    case "name-mismatch":
      return t("reconcileRename", { from: path, to: finding.newName ?? path });
    case "missing-sidecar":
      return t("reconcileAdopt", { path });
    case "missing-media":
      return finding.action === "cloud-only"
        ? t("reconcileCloudOnly", { name })
        : t("reconcileToOrphans", { name });
    case "orphan-companion":
      return t("reconcileOrphanCompanion", { path });
    case "stem-conflict":
      return t("reconcileStemConflict", { path });
    case "shared-companion":
      return t("reconcileSharedCompanion", { path });
    case "duplicate-identity":
      return t("reconcileDuplicateIdentity", { path });
    case "unreadable-record":
      return t("reconcileUnreadable", { path });
    case "not-recognized":
      return t("reconcileNotRecognized", { path });
  }
}

function FindingList({
  heading,
  findings,
  t,
}: {
  heading: string;
  findings: ReconcileFinding[];
  t: LibraryT;
}): React.JSX.Element | null {
  if (findings.length === 0) return null;
  return (
    <section className={styles.group}>
      <h3 className={styles.groupHeading}>{heading}</h3>
      <ul className={styles.list}>
        {findings.slice(0, MAX_ROWS).map((finding) => (
          <li key={`${finding.kind}:${finding.path}`} className={styles.row}>
            {describeFinding(finding, t)}
          </li>
        ))}
        {findings.length > MAX_ROWS && (
          <li className={styles.more}>
            {t("reconcileMore", { count: findings.length - MAX_ROWS })}
          </li>
        )}
      </ul>
    </section>
  );
}

function Findings({
  findings,
  t,
}: {
  findings: ReconcileFinding[];
  t: LibraryT;
}): React.JSX.Element {
  const fixable = findings.filter((f) => f.fixable);
  const listed = findings.filter((f) => !f.fixable);
  return (
    <div className={styles.findings}>
      <FindingList
        heading={t("reconcileFixableHeading", { count: fixable.length })}
        findings={fixable}
        t={t}
      />
      <FindingList
        heading={t("reconcileListedHeading", { count: listed.length })}
        findings={listed}
        t={t}
      />
    </div>
  );
}

function ScanBody({
  scan,
  t,
}: {
  scan: ReconcileScanResult | null;
  t: LibraryT;
}): React.JSX.Element {
  if (!scan) return <ModalText>{t("reconcileScanning")}</ModalText>;
  switch (scan.status) {
    case "busy":
      return (
        <ModalText>
          {t(scan.activity === "export" ? "reconcileBusyExport" : "reconcileBusyRecording")}
        </ModalText>
      );
    case "maintenance":
      return <ModalText>{t("reconcileAlreadyRunning")}</ModalText>;
    case "error":
      return <ModalText>{t("reconcileScanError", { message: scan.message })}</ModalText>;
    case "ok":
      return scan.findings.length === 0 ? (
        <ModalText>{t("reconcileEverythingMatches")}</ModalText>
      ) : (
        <Findings findings={scan.findings} t={t} />
      );
  }
}

const ACTIVITY_KEYS = {
  library: "reconcileActivity_library",
  editor: "reconcileActivity_editor",
  screenshot: "reconcileActivity_screenshot",
  recovery: "reconcileActivity_recovery",
  folder: "reconcileActivity_folder",
} as const;

function RunBody({ run, t }: { run: Exclude<ReconcileRun, { phase: "idle" }>; t: LibraryT }) {
  if (run.phase === "waiting") {
    const what = run.waitingFor
      .map((kind) => ACTIVITY_KEYS[kind as keyof typeof ACTIVITY_KEYS])
      .filter(Boolean)
      .map((key) => t(key));
    return (
      <ModalText>
        {what.length > 0
          ? t("reconcileWaiting", { what: what.join(", ") })
          : t("reconcileWaitingSomething")}
      </ModalText>
    );
  }
  if (run.phase === "fixing") {
    return (
      <div className={styles.progress}>
        <ModalText>{t("reconcileFixing", { done: run.done, total: run.total })}</ModalText>
        <progress max={Math.max(run.total, 1)} value={run.done} className={styles.bar} />
      </div>
    );
  }
  const { result } = run;
  switch (result.status) {
    case "busy":
      return (
        <ModalText>
          {t(result.activity === "export" ? "reconcileBusyExport" : "reconcileBusyRecording")}
        </ModalText>
      );
    case "already-running":
      return <ModalText>{t("reconcileAlreadyRunning")}</ModalText>;
    case "error":
      return <ModalText>{t("reconcileError", { message: result.message })}</ModalText>;
    case "cancelled":
      return null;
    case "done": {
      const { report } = result;
      return (
        <div className={styles.findings}>
          <ModalText>
            {t("reconcileDone", { fixed: report.fixed, moved: report.movedToOrphans })}
          </ModalText>
          {report.kept.length > 0 && (
            <ModalText>{t("reconcileKept", { count: report.kept.length })}</ModalText>
          )}
          {report.failed.length > 0 && (
            <ModalText>{t("reconcileFailed", { count: report.failed.length })}</ModalText>
          )}
        </div>
      );
    }
  }
}

/** The "Check and fix files" dialog, mounted once in the app shell. */
export function ReconcileDialogHost(): React.JSX.Element | null {
  const t = useTranslations("library");
  const { dialogOpen, scan, scanning, run } = useReconcile();
  if (!dialogOpen) return null;
  const fixing = run.phase === "fixing";
  const canFix =
    run.phase === "idle" && !scanning && scan?.status === "ok" && scan.fixableCount > 0;
  return (
    // Non-dismissible only while files are being fixed.
    <ModalOverlay
      onCancel={fixing ? () => {} : closeReconcileDialog}
      labelledBy="reconcile-dialog-title"
      size="wide"
    >
      <div className={styles.sheet}>
        <ModalIcon tone="accent">
          <FolderSync size={20} strokeWidth={1.8} />
        </ModalIcon>
        <ModalTitle id="reconcile-dialog-title">{t("reconcileTitle")}</ModalTitle>
        {run.phase === "idle" ? (
          <>
            <ModalText>{t("reconcileIntro")}</ModalText>
            <ScanBody scan={scanning ? null : scan} t={t} />
          </>
        ) : (
          <RunBody run={run} t={t} />
        )}
        <ModalActions>
          {run.phase === "waiting" && (
            <ModalButton variant="ghost" onClick={cancelWaiting}>
              {t("reconcileCancel")}
            </ModalButton>
          )}
          {run.phase === "finished" && (
            // "Check again": back to the list, freshly scanned.
            <ModalButton variant="ghost" onClick={openReconcileDialog}>
              {t("reconcileCheckAgain")}
            </ModalButton>
          )}
          {!fixing && (
            <ModalButton variant="ghost" onClick={closeReconcileDialog}>
              {t("reconcileClose")}
            </ModalButton>
          )}
          {canFix && (
            <ModalButton variant="primary" onClick={() => void fixAll()}>
              {t("reconcileFixAll")}
            </ModalButton>
          )}
        </ModalActions>
      </div>
    </ModalOverlay>
  );
}
