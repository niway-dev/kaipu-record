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
import { useEffect, useRef, useState } from "react";
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
  setFixing,
  fixAll,
  openReconcileDialog,
  useReconcile,
  type ReconcileRun,
} from "./reconcile-store";
import styles from "./reconcile.module.css";

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

/** A native checkbox that can also show "some" (a group with unticked files). */
function Check({
  checked,
  partial = false,
  label,
  onChange,
}: {
  checked: boolean;
  partial?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.check}
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function FindingItem({
  finding,
  selectable,
  fixing,
  t,
}: {
  finding: ReconcileFinding;
  /** Fixable findings carry a checkbox; listed ones are never touched. */
  selectable: boolean;
  fixing: boolean;
  t: LibraryT;
}) {
  const row = describeFinding(finding, t);
  const Icon = ICONS[row.icon];
  const renamed = row.renamedTo !== undefined;
  return (
    <li
      className={`${styles.row} ${selectable ? styles.rowSelectable : ""} ${selectable && !fixing ? styles.rowOff : ""}`}
      // The whole row is the target, so a near miss on the 16 px box still toggles it. The
      // box's own click already toggled through its onChange.
      onClick={
        selectable
          ? (event) => {
              if ((event.target as HTMLElement).closest("input")) return;
              // A drag that selected a name to copy it ends in a click too: not a toggle.
              if (window.getSelection()?.toString()) return;
              setFixing([finding.path], !fixing);
            }
          : undefined
      }
    >
      {selectable && (
        <Check
          checked={fixing}
          label={
            row.renamedTo !== undefined
              ? t("reconcileFixRename", { name: row.now, newName: row.renamedTo })
              : t("reconcileFixThis", { name: row.now })
          }
          onChange={(checked) => setFixing([finding.path], checked)}
        />
      )}
      <Icon size={13} strokeWidth={1.8} aria-hidden className={styles.rowIcon} />
      <span className={styles.rowNow} title={row.now}>
        {row.now}
      </span>
      {renamed ? (
        <>
          <ArrowRight
            size={12}
            strokeWidth={2}
            aria-label={t("reconcileRenamedTo")}
            className={styles.rowArrow}
          />
          <span className={styles.rowAfter} title={row.renamedTo}>
            {row.renamedTo}
          </span>
        </>
      ) : (
        <span className={styles.rowNote} title={row.note}>
          {row.note}
        </span>
      )}
    </li>
  );
}

function FindingGroup({
  group,
  findings,
  open,
  onToggle,
  skipped,
  t,
}: {
  group: (typeof GROUPS)[number];
  findings: ReconcileFinding[];
  open: boolean;
  onToggle: () => void;
  skipped: ReadonlySet<string>;
  t: LibraryT;
}): React.JSX.Element {
  const Icon = group.icon;
  const selectable = group.id !== "listed";
  const off = selectable ? findings.filter((f) => skipped.has(f.path)).length : 0;
  const on = findings.length - off;
  const bodyId = `reconcile-group-${group.id}`;
  return (
    <section
      className={`${styles.group} ${TONE_CLASS[group.id] ?? ""}`}
      data-group={group.id}
      data-open={open || undefined}
    >
      <div className={styles.groupHeader}>
        {selectable && (
          <Check
            checked={on > 0}
            partial={on > 0 && off > 0}
            label={t("reconcileFixGroup", { group: t(group.title) })}
            onChange={(checked) =>
              setFixing(
                findings.map((f) => f.path),
                checked,
              )
            }
          />
        )}
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className={styles.groupIcon} aria-hidden>
            <Icon size={16} strokeWidth={1.8} />
          </span>
          <span className={`${styles.groupText} ${selectable && on === 0 ? styles.groupOff : ""}`}>
            <span className={styles.groupTitleLine}>
              <span className={styles.groupTitle}>{t(group.title)}</span>
              <span className={styles.groupCount}>
                {off > 0
                  ? t("reconcileGroupCountPartial", { on, count: findings.length })
                  : t("reconcileGroupCount", { count: findings.length })}
              </span>
            </span>
            <span className={styles.groupAction}>{t(group.action)}</span>
          </span>
          <ChevronDown size={14} strokeWidth={2} aria-hidden className={styles.chevron} />
        </button>
      </div>
      {open && (
        <div className={styles.groupBody} id={bodyId}>
          <p className={styles.groupWhat}>
            <Info size={13} strokeWidth={2} aria-hidden className={styles.groupWhatIcon} />
            {t(group.what)}
          </p>
          {/* Every finding gets a row (and its own checkbox): the list scrolls, nothing is cut. */}
          <ul className={styles.rows}>
            {findings.map((finding) => (
              <FindingItem
                key={`${finding.kind}:${finding.path}`}
                finding={finding}
                selectable={selectable}
                fixing={!skipped.has(finding.path)}
                t={t}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Findings({
  findings,
  skipped,
  t,
}: {
  findings: ReconcileFinding[];
  skipped: ReadonlySet<string>;
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
  // One group open at a time, so a long one never pushes the others out of the dialog.
  const [openId, setOpenId] = useState<GroupId | null>(present[0]?.id ?? null);
  return (
    <div className={styles.findings}>
      {present.map((group) => (
        <FindingGroup
          key={group.id}
          group={group}
          findings={byGroup.get(group.id)!}
          open={openId === group.id}
          onToggle={() => setOpenId(openId === group.id ? null : group.id)}
          skipped={skipped}
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
  skipped,
  t,
}: {
  scan: ReconcileScanResult | null;
  skipped: ReadonlySet<string>;
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
      return (
        <>
          <SafetyNote t={t} />
          <Findings findings={scan.findings} skipped={skipped} t={t} />
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
  const { dialogOpen, scan, scanning, run, skipped } = useReconcile();
  if (!dialogOpen) return null;
  const fixing = run.phase === "fixing";
  const canFix =
    run.phase === "idle" && !scanning && scan?.status === "ok" && scan.fixableCount > 0;
  const listShown =
    run.phase === "idle" && !scanning && scan?.status === "ok" && scan.findings.length > 0;
  const selected = canFix
    ? scan.findings.filter((f) => f.fixable && !skipped.has(f.path)).length
    : 0;
  return (
    // Non-dismissible only while files are being fixed.
    <ModalOverlay
      onCancel={fixing ? () => {} : closeReconcileDialog}
      labelledBy="reconcile-dialog-title"
      size="wide"
    >
      <div className={styles.sheet}>
        {/* Icon beside the title, as in the design: the list gets the height instead. */}
        <header className={styles.header}>
          <ModalIcon tone="accent">
            <FolderSync size={20} strokeWidth={1.8} />
          </ModalIcon>
          <div className={styles.headerText}>
            <ModalTitle id="reconcile-dialog-title">{t("reconcileTitle")}</ModalTitle>
            {/* The intro describes a finished scan, so it only shows above an actual list. */}
            {listShown && (
              <p className={styles.intro}>
                {t(scan.fixableCount > 0 ? "reconcileIntro" : "reconcileIntroListedOnly")}
              </p>
            )}
          </div>
        </header>
        <div className={styles.body}>
          {run.phase === "idle" ? (
            <ScanBody scan={scanning ? null : scan} skipped={skipped} t={t} />
          ) : (
            <RunBody run={run} t={t} />
          )}
        </div>
        {canFix && (
          <p className={styles.summary}>
            {selected === scan.fixableCount
              ? t("reconcileSummary", {
                  fixable: scan.fixableCount,
                  listed: scan.findings.length - scan.fixableCount,
                })
              : t("reconcileSummarySelected", {
                  selected,
                  fixable: scan.fixableCount,
                  untouched: scan.findings.length - selected,
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
            <ModalButton variant="primary" disabled={selected === 0} onClick={() => void fixAll()}>
              {selected === scan.fixableCount
                ? t("reconcileFixAll")
                : t("reconcileFixSelected", { count: selected })}
            </ModalButton>
          )}
        </ModalActions>
      </div>
    </ModalOverlay>
  );
}
