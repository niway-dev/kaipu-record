import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  FilePlus2,
  FileText,
  Film,
  FolderSync,
  Image as ImageIcon,
  Info,
  PenLine,
  ShieldCheck,
  Unlink,
} from "lucide-react";
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

/**
 * The dialog groups findings by what happens to them, so each group can say why once
 * instead of repeating a note on every row. Every kind belongs to exactly one group.
 */
type GroupId = "rename" | "adopt" | "gone" | "listed";

const GROUP_OF: Record<ReconcileFinding["kind"], GroupId> = {
  "stale-auto-title": "rename",
  "untitled-legacy": "rename",
  "name-mismatch": "rename",
  "missing-sidecar": "adopt",
  "missing-media": "gone",
  "orphan-companion": "gone",
  "stem-conflict": "listed",
  "shared-companion": "listed",
  "duplicate-identity": "listed",
  "unreadable-record": "listed",
  "not-recognized": "listed",
  "unreadable-orphan-run": "listed",
};

const GROUPS = [
  {
    id: "rename",
    icon: PenLine,
    title: "reconcileGroupRenameTitle",
    action: "reconcileGroupRenameAction",
    what: "reconcileGroupRenameWhat",
  },
  {
    id: "adopt",
    icon: FilePlus2,
    title: "reconcileGroupAdoptTitle",
    action: "reconcileGroupAdoptAction",
    what: "reconcileGroupAdoptWhat",
  },
  {
    id: "gone",
    icon: Unlink,
    title: "reconcileGroupGoneTitle",
    action: "reconcileGroupGoneAction",
    what: "reconcileGroupGoneWhat",
  },
  {
    id: "listed",
    icon: CircleAlert,
    title: "reconcileGroupListedTitle",
    action: "reconcileGroupListedAction",
    what: "reconcileGroupListedWhat",
  },
] as const;

const TONE_CLASS: Record<GroupId, string | undefined> = {
  rename: styles.toneRename,
  adopt: styles.toneAdopt,
  gone: styles.toneGone,
  listed: styles.toneListed,
};

function FindingItem({ finding, t }: { finding: ReconcileFinding; t: LibraryT }) {
  const row = describeFinding(finding, t);
  const Icon = ICONS[row.icon];
  const renamed = row.renamedTo !== undefined;
  return (
    <li className={styles.row}>
      <Icon size={13} strokeWidth={1.8} aria-hidden className={styles.rowIcon} />
      <span className={styles.rowNow}>{row.now}</span>
      {renamed ? (
        <>
          <ArrowRight
            size={12}
            strokeWidth={2}
            aria-label={t("reconcileRenamedTo")}
            className={styles.rowArrow}
          />
          <span className={styles.rowAfter}>{row.renamedTo}</span>
        </>
      ) : (
        <span className={styles.rowNote}>{row.note}</span>
      )}
    </li>
  );
}

function FindingGroup({
  group,
  findings,
  defaultOpen,
  t,
}: {
  group: (typeof GROUPS)[number];
  findings: ReconcileFinding[];
  defaultOpen: boolean;
  t: LibraryT;
}): React.JSX.Element {
  const Icon = group.icon;
  return (
    <details
      className={`${styles.group} ${TONE_CLASS[group.id] ?? ""}`}
      open={defaultOpen}
      data-group={group.id}
    >
      <summary className={styles.groupHeader}>
        <span className={styles.groupIcon} aria-hidden>
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span className={styles.groupText}>
          <span className={styles.groupTitleLine}>
            <span className={styles.groupTitle}>{t(group.title)}</span>
            <span className={styles.groupCount}>
              {t("reconcileGroupCount", { count: findings.length })}
            </span>
          </span>
          <span className={styles.groupAction}>{t(group.action)}</span>
        </span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden className={styles.chevron} />
      </summary>
      <div className={styles.groupBody}>
        <p className={styles.groupWhat}>
          <Info size={13} strokeWidth={2} aria-hidden className={styles.groupWhatIcon} />
          {t(group.what)}
        </p>
        <ul className={styles.rows}>
          {findings.slice(0, MAX_ROWS).map((finding) => (
            <FindingItem key={`${finding.kind}:${finding.path}`} finding={finding} t={t} />
          ))}
        </ul>
        {findings.length > MAX_ROWS && (
          <p className={styles.more}>{t("reconcileMore", { count: findings.length - MAX_ROWS })}</p>
        )}
      </div>
    </details>
  );
}

function Findings({
  findings,
  t,
}: {
  findings: ReconcileFinding[];
  t: LibraryT;
}): React.JSX.Element {
  const byGroup = new Map<GroupId, ReconcileFinding[]>();
  for (const finding of findings) {
    const id = GROUP_OF[finding.kind];
    const bucket = byGroup.get(id);
    if (bucket) bucket.push(finding);
    else byGroup.set(id, [finding]);
  }
  const present = GROUPS.filter((group) => byGroup.has(group.id));
  return (
    <div className={styles.findings}>
      {present.map((group, index) => (
        <FindingGroup
          key={group.id}
          group={group}
          findings={byGroup.get(group.id)!}
          defaultOpen={index === 0}
          t={t}
        />
      ))}
    </div>
  );
}

function SafetyNote({ t }: { t: LibraryT }): React.JSX.Element {
  return (
    <p className={styles.safety}>
      <ShieldCheck size={15} strokeWidth={1.9} aria-hidden className={styles.safetyIcon} />
      <span>
        <strong>{t("reconcileSafeTitle")}</strong> {t("reconcileSafeBody")}
      </span>
    </p>
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
      if (scan.findings.length === 0) {
        return <ModalText>{t("reconcileEverythingMatches")}</ModalText>;
      }
      // The intro describes a finished scan, so it only sits above an actual list.
      return (
        <>
          <ModalText>
            {t(scan.fixableCount > 0 ? "reconcileIntro" : "reconcileIntroListedOnly")}
          </ModalText>
          <SafetyNote t={t} />
          <Findings findings={scan.findings} t={t} />
        </>
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
        <div className={styles.progressLine}>
          <span>{t("reconcileFixing", { done: run.done, total: run.total })}</span>
          <span className={styles.progressPercent} aria-hidden>
            {Math.round((run.done / Math.max(run.total, 1)) * 100)}%
          </span>
        </div>
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
      const tiles = [
        {
          key: "fixed",
          label: t("reconcileTileFixed"),
          value: report.fixed,
          tone: styles.toneAdopt,
        },
        {
          key: "moved",
          label: t("reconcileTileMoved"),
          value: report.movedToOrphans,
          tone: styles.toneGone,
        },
        {
          key: "kept",
          label: t("reconcileTileKept"),
          value: report.kept.length,
          tone: styles.toneListed,
        },
        {
          key: "failed",
          label: t("reconcileTileFailed"),
          value: report.failed.length,
          tone: styles.toneFailed,
        },
      ].filter((tile) => tile.key === "fixed" || tile.key === "moved" || tile.value > 0);
      return (
        <div className={styles.report}>
          <ModalText>
            {t("reconcileDone", { fixed: report.fixed, moved: report.movedToOrphans })}
          </ModalText>
          <ul className={styles.tiles} aria-hidden>
            {tiles.map((tile) => (
              <li key={tile.key} className={`${styles.tile} ${tile.tone ?? ""}`}>
                <span className={styles.tileValue}>{tile.value}</span>
                <span className={styles.tileLabel}>{tile.label}</span>
              </li>
            ))}
          </ul>
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
          <ScanBody scan={scanning ? null : scan} t={t} />
        ) : (
          <RunBody run={run} t={t} />
        )}
        {canFix && (
          <p className={styles.summary}>
            {t("reconcileSummary", {
              fixable: scan.fixableCount,
              listed: scan.findings.length - scan.fixableCount,
            })}
          </p>
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
