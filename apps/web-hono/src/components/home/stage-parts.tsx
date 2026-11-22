import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Apple, Check, ChevronsUpDown, Folder } from "lucide-react";
import type { Translator } from "@kaipu/i18n";

import { DownloadLink } from "@/components/download-link";
import { downloadUrls } from "@/lib/download";

import { WORKSPACE_IDS, workspaceFolder, type WorkspaceId } from "./hero-stage-model";
import styles from "./hero-stage.module.css";

export type T = Translator<"landing">;

/**
 * The page being recorded, photographed, edited and exported: the hero's own
 * brand statement and download button, drawn as a picture. Its type scales with
 * the screen it sits in, so the same picture fits the desktop stage and the
 * phone's compact one.
 *
 * By default it is decorative (`aria-hidden`), which is right wherever a layer
 * above it owns the pointer (the Screenshot selection, the Edit annotation
 * canvas): a click there draws, it never downloads. Where nothing covers it
 * (`download`, as in Record) the button is a real installer link that opens in
 * a new tab, so the demo the visitor is using stays where it was. Only the
 * headline is hidden from assistive tech then; hiding the link would nest an
 * interactive element in `aria-hidden`.
 */
export function SampleScreen({ t, download = false }: { t: T; download?: boolean }) {
  return (
    <div className={styles.sample} aria-hidden={download ? undefined : true}>
      <p className={styles.sampleTitle} aria-hidden={download ? true : undefined}>
        <BrandStatement t={t} />
      </p>
      {download ? (
        <DownloadLink
          placement="hero-demo"
          href={downloadUrls.macArm64}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.samplePill} ${styles.samplePillLink}`}
        >
          <Apple size={14} aria-hidden />
          {t("homeHeroCtaPrimary")}
        </DownloadLink>
      ) : (
        <span className={styles.samplePill}>
          <Apple size={14} aria-hidden />
          {t("homeHeroCtaPrimary")}
        </span>
      )}
    </div>
  );
}

/**
 * "From your screen. To the world.", as two lines with a highlighter swash behind
 * the last word. Each part is its own message, so a language moves the swash to
 * whichever word carries the idea instead of splitting an English sentence. Used
 * by the overview's headline and by the sample screen, so they match.
 */
export function BrandStatement({ t }: { t: T }) {
  return (
    <>
      <span>{t("homeStageBrandA")}</span>{" "}
      <span>
        {t("homeStageBrandBPre")} <mark className={styles.marker}>{t("homeStageBrandBMark")}</mark>
        {t("homeStageBrandBPost")}
      </span>
    </>
  );
}

/** What stops the workspace from changing: the app locks it while it is writing. */
export type WorkspaceLock = "recording" | "exporting" | null;

/** Reports what is locking the workspace switcher, and clears it when the step unmounts. */
export function useWorkspaceLock(onLock: (lock: WorkspaceLock) => void, lock: WorkspaceLock) {
  useEffect(() => {
    onLock(lock);
    return () => onLock(null);
  }, [onLock, lock]);
}

export const workspaceName = (t: T, id: WorkspaceId) =>
  id === "personal" ? t("homeStageWsPersonal") : t("homeStageWsWork");

const TILE: Record<WorkspaceId, { initials: string; color: string }> = {
  personal: { initials: "P", color: "var(--kl-c1)" },
  work: { initials: "W", color: "var(--kl-c2)" },
};

/** The workspace's square: its initial on its own color, as in the app's switcher. */
function Tile({ id }: { id: WorkspaceId }) {
  return (
    <span className={styles.wsTile} style={{ background: TILE[id].color }} aria-hidden>
      {TILE[id].initials}
    </span>
  );
}

/**
 * The workspace switcher, as the stage's top bar: which workspace is active and
 * the real-looking folder it saves into. The same bar sits over Record,
 * Screenshot, Edit and Export, and the choice lives in the hero, so it survives
 * a change of step. Like the app, it will not switch while a recording or an
 * export is running. Folders are sample paths built the way the app builds them.
 */
export function WorkspaceBar({
  t,
  workspace,
  onWorkspace,
  lock,
  onOpenChange,
}: {
  t: T;
  workspace: WorkspaceId;
  onWorkspace: (id: WorkspaceId) => void;
  lock: WorkspaceLock;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const setOpen = (value: boolean) => {
    setOpenState(value);
    onOpenChange(value);
  };
  const name = workspaceName(t, workspace);
  const folder = workspaceFolder(workspace, name);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      setOpenState(false);
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenState(false);
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);
  // A step that unmounts the bar while its menu is open must not leave the hero holding.
  useEffect(() => () => onOpenChange(false), [onOpenChange]);

  const lockedText =
    lock === "recording"
      ? t("homeStageWsLockedRecording")
      : lock === "exporting"
        ? t("homeStageWsLockedExporting")
        : null;

  return (
    <div className={styles.wsBar} ref={root} data-testid="workspace-bar">
      <button
        type="button"
        className={styles.wsButton}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${t("homeStageWorkspaceSwitch")}: ${name}`}
        onClick={() => setOpen(!open)}
      >
        <Tile id={workspace} />
        <span className={styles.wsName}>{name}</span>
        <ChevronsUpDown size={13} aria-hidden />
      </button>
      <span className={styles.wsSaving}>
        <Folder size={13} aria-hidden />
        <span className={styles.wsLabel}>{t("homeStageWorkspaceSavingTo")}</span>
        <span className={styles.wsPath} data-testid="workspace-folder">
          {folder}
        </span>
      </span>

      {open && (
        <div
          className={styles.wsMenu}
          id={menuId}
          role="group"
          aria-label={t("homeStageWorkspace")}
        >
          {WORKSPACE_IDS.map((id) => {
            const rowName = workspaceName(t, id);
            const active = id === workspace;
            return (
              <button
                key={id}
                type="button"
                className={`${styles.wsRow} ${active ? styles.wsRowOn : ""}`}
                aria-pressed={active}
                disabled={lock !== null && !active}
                onClick={() => {
                  onWorkspace(id);
                  setOpen(false);
                }}
              >
                <Tile id={id} />
                <span className={styles.wsRowText}>
                  <span className={styles.wsRowName}>{rowName}</span>
                  <span className={styles.wsRowPath}>{workspaceFolder(id, rowName)}</span>
                </span>
                {active && <Check size={14} aria-hidden />}
              </button>
            );
          })}
          <p className={styles.wsNote}>{lockedText ?? t("homeStageWorkspaceHint")}</p>
        </div>
      )}
    </div>
  );
}

/** A row of mutually exclusive choices; each one is a pressed/unpressed button. */
export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: ReactNode; name?: string }[];
  onChange: (value: V) => void;
  className?: string;
}) {
  return (
    <div className={`${styles.seg} ${className ?? ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`${styles.segBtn} ${o.value === value ? styles.segOn : ""}`}
          aria-pressed={o.value === value}
          aria-label={o.name}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
