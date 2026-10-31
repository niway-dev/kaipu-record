import { FileText, Film, FolderSync, Image as ImageIcon } from "lucide-react";
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

/** Rows rendered per table; a vault with hundreds of findings shows "…and N more". */
const MAX_ROWS = 200;

type LibraryT = Translator<"library">;

const fileName = (path: string): string => path.split("/").pop() ?? path;

const MEDIA_EXT = /\.(mp4|webm|mov|gif|png|jpe?g|webp)$/u;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/u;

/** A file's name without its media extension: the row icon carries the kind. */
const withoutExt = (name: string): string => name.replace(MEDIA_EXT, "");

/** One finding as a table row: the file as it is now, and what happens to it. */
export interface FindingRow {
  /** The file (or record) as it is now. */
  now: string;
  /** Renames: the new name. */
  renamedTo?: string;
  /** Everything else: what happens to it, or why it stays. */
  note?: string;
  icon: "video" | "image" | "record";
}

function rowIcon(path: string): FindingRow["icon"] {
  if (IMAGE_EXT.test(path)) return "image";
  return MEDIA_EXT.test(path) ? "video" : "record";
}

export function describeFinding(finding: ReconcileFinding, t: LibraryT): FindingRow {
  const path = finding.path;
  const icon = rowIcon(path);
  const note = (text: string, now = path): FindingRow => ({ now, note: text, icon });
  switch (finding.kind) {
    case "stale-auto-title":
    case "untitled-legacy":
    case "name-mismatch":
      return {
        now: withoutExt(path),
        renamedTo: withoutExt(finding.newName ?? path),
        icon,
      };
    case "missing-sidecar":
      return note(t("reconcileAdopt"), withoutExt(path));
    case "missing-media": {
      const name = finding.title || fileName(path);
      return note(
        finding.action === "cloud-only" ? t("reconcileCloudOnly") : t("reconcileToOrphans"),
        name,
      );
    }
    case "orphan-companion":
      return note(t("reconcileOrphanCompanion"));
    case "stem-conflict":
      return note(t("reconcileStemConflict"));
    case "shared-companion":
      return note(t("reconcileSharedCompanion"));
    case "duplicate-identity":
      return note(t("reconcileDuplicateIdentity"));
    case "unreadable-record":
      return note(t("reconcileUnreadable"));
    case "not-recognized":
      return note(t("reconcileNotRecognized"));
    case "unreadable-orphan-run":
      return note(t("reconcileUnreadableOrphanRun"));
  }
}

const ICONS = { video: Film, image: ImageIcon, record: FileText } as const;

function FindingTable({
  heading,
  columns,
  findings,
  t,
}: {
  heading: string;
  columns: [string, string];
  findings: ReconcileFinding[];
  t: LibraryT;
}): React.JSX.Element | null {
  if (findings.length === 0) return null;
  return (
    <section className={styles.group}>
      <h3 className={styles.groupHeading}>{heading}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.nowCell}>
              {columns[0]}
            </th>
            <th scope="col" aria-hidden className={styles.arrowCell} />
            <th scope="col">{columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {findings.slice(0, MAX_ROWS).map((finding) => {
            const row = describeFinding(finding, t);
            const Icon = ICONS[row.icon];
            return (
              <tr key={`${finding.kind}:${finding.path}`}>
                <td className={styles.nowCell}>
                  <span className={styles.name}>
                    <Icon size={13} strokeWidth={1.8} aria-hidden className={styles.icon} />
                    {row.now}
                  </span>
                </td>
                <td aria-hidden className={styles.arrowCell}>
                  {row.renamedTo !== undefined && "→"}
                </td>
                <td className={row.renamedTo !== undefined ? styles.afterCell : styles.noteCell}>
                  {row.renamedTo ?? row.note}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {findings.length > MAX_ROWS && (
        <p className={styles.more}>{t("reconcileMore", { count: findings.length - MAX_ROWS })}</p>
      )}
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
      <FindingTable
        heading={t("reconcileFixableHeading", { count: fixable.length })}
        columns={[t("reconcileColumnNow"), t("reconcileColumnAfter")]}
        findings={fixable}
        t={t}
      />
      <FindingTable
        heading={t("reconcileListedHeading", { count: listed.length })}
        columns={[t("reconcileColumnFile"), t("reconcileColumnWhy")]}
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
