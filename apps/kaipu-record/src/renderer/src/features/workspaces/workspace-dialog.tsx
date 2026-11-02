import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button, Input, ModalButton, ModalOverlay } from "@kaipu/ui";
import { TAG_COLORS, nextTagColor, type TagColor } from "@kaipu/domain/constants";
import { useTranslations } from "@kaipu/i18n";
import type {
  LocationCheck,
  WorkspaceCreateRefusal,
  WorkspaceCreateResult,
  WorkspaceEditRefusal,
  WorkspaceEditResult,
  WorkspaceRelocateResult,
  WorkspacesState,
  WorkspaceView,
} from "@shared/types/workspaces";
import { validateWorkspaceName } from "@shared/workspace-name";
import "@renderer/features/library/tags/tag-palette.css";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { FolderPath } from "./folder-path";
import { relocateRefusalMessage } from "./relocate-copy";
import styles from "./workspace-dialog.module.css";

type Created = Extract<WorkspaceCreateResult, { ok: true }>;
type Saved = Extract<WorkspaceEditResult, { ok: true }>;
type Relocated = Extract<WorkspaceRelocateResult, { ok: true }>;

export interface WorkspaceDialogProps {
  state: WorkspacesState;
  /** The workspace being edited, or null for "New workspace". */
  editing: WorkspaceView | null;
  /** False for "Move to ▸ New workspace…": created inactive, the user stays where they are. */
  activate?: boolean;
  onClose(): void;
  /** "Use an existing folder…": the folder-picker flow, for Google Drive or OneDrive folders. */
  onUseExisting(): void;
  onCreated(result: Created): void;
  onSaved(result: Saved): void;
  /** "Change folder…" pointed the workspace at a new folder (applied at once, not on Save). */
  onRelocated(result: Relocated): void;
}

/** What a location check allows: a free name, or an empty folder that is already there. */
const USABLE: ReadonlySet<LocationCheck["state"]> = new Set(["free", "empty"]);

/**
 * "New workspace" and "Edit workspace" (NIW2-599): a name, a color and, for a new one, where its
 * folder goes. A new workspace gets a NEW folder `Kaipu Record — <name>` next to the Default
 * workspace's, shown in full; adopting an existing folder stays one click away. The folder is
 * only ever text: it changes through a button that opens the native folder picker.
 */
export function WorkspaceDialog({
  state,
  editing,
  activate = true,
  onClose,
  onUseExisting,
  onCreated,
  onSaved,
  onRelocated,
}: WorkspaceDialogProps): React.JSX.Element {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const tl = useTranslations("library");
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState<TagColor>(
    () => editing?.color ?? nextTagColor(state.workspaces.map((w) => w.color)),
  );
  const [location, setLocation] = useState<LocationCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [relocating, setRelocating] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  // `*-uncertain`: the call itself rejected (the IPC closed, main threw), so what it did is
  // unknown. A rejected create may already have registered the workspace.
  const [refusal, setRefusal] = useState<
    WorkspaceCreateRefusal | WorkspaceEditRefusal | "create-uncertain" | "edit-uncertain" | null
  >(null);

  const check = validateWorkspaceName(name, state.workspaces, editing?.id);
  const validName = check.ok ? check.name : null;

  // The overlay focuses itself when it mounts, after its children's effects: take the focus
  // back for the field the user came to fill.
  useEffect(() => {
    const frame = requestAnimationFrame(() => formRef.current?.querySelector("input")?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  // Where the folder would go, asked of main (it knows the Default workspace's folder). An
  // answer for a name that is no longer in the box is dropped.
  useEffect(() => {
    if (editing) return;
    setLocation(null);
    if (!validName) return;
    let alive = true;
    void window.electronAPI.workspaces.checkLocation(name).then((next) => {
      if (alive) setLocation(next);
    });
    return () => {
      alive = false;
    };
    // `name` rather than `validName`: the path follows what the user typed, normalized by main.
  }, [editing, name, validName]);

  const changed = editing ? validName !== editing.name || color !== editing.color : true;
  const canSubmit =
    !busy &&
    !state.readOnly &&
    validName !== null &&
    changed &&
    (editing ? true : location !== null && USABLE.has(location.state));

  const submit = async (): Promise<void> => {
    if (!canSubmit || !validName) return;
    setBusy(true);
    setRefusal(null);
    try {
      if (editing) {
        const result = await window.electronAPI.workspaces.edit({
          id: editing.id,
          ...(validName !== editing.name ? { name: validName } : {}),
          ...(color !== editing.color ? { color } : {}),
        });
        if (result.ok) onSaved(result);
        else setRefusal(result.reason);
      } else {
        const result = await window.electronAPI.workspaces.create({
          name: validName,
          color,
          ...(activate ? {} : { activate: false }),
        });
        if (result.ok) onCreated(result);
        else setRefusal(result.reason);
      }
    } catch {
      setRefusal(editing ? "edit-uncertain" : "create-uncertain");
    } finally {
      setBusy(false);
    }
  };

  // "Change folder…": the picker opens in main, which also enforces every rule about which
  // folder may be chosen. The folder changes at once; Save is only for the name and color.
  const changeFolder = async (): Promise<void> => {
    if (!editing || relocating) return;
    setRelocating(true);
    setFolderError(null);
    try {
      const result = await window.electronAPI.workspaces.relocate(editing.id);
      if (result.ok) onRelocated(result);
      else setFolderError(relocateRefusalMessage(result, editing.name, t));
    } catch {
      // Rejected after main may already have applied the new folder: the result is unknown.
      setFolderError(t("relocateUncertain"));
    } finally {
      setRelocating(false);
    }
  };

  const away = editing?.state === "unavailable";
  const nameError = !check.ok && check.reason === "taken" ? t("nameTaken") : null;
  const title = editing ? t("editTitle") : t("newTitle");

  return (
    <ModalOverlay onCancel={onClose} labelledBy={`${id}-title`} size="wide">
      <form
        ref={formRef}
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header className={styles.header}>
          <h3 id={`${id}-title`} className={styles.title}>
            {title}
          </h3>
          <button type="button" className={styles.close} aria-label={tc("close")} onClick={onClose}>
            <X size={14} strokeWidth={1.8} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.field}>
            <Input
              id={`${id}-name`}
              label={t("nameLabel")}
              value={name}
              placeholder={t("namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? `${id}-name-error` : undefined}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setRefusal(null);
              }}
            />
            {nameError && (
              <p id={`${id}-name-error`} className={styles.error}>
                {nameError}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <span className={styles.label} id={`${id}-color`}>
              {t("colorLabel")}
            </span>
            <div className={styles.swatches} role="radiogroup" aria-labelledby={`${id}-color`}>
              {TAG_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={option === color}
                  aria-label={tl(`tagColor_${option}`)}
                  title={tl(`tagColor_${option}`)}
                  className={styles.swatch}
                  data-color={option}
                  onClick={() => setColor(option)}
                />
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{editing ? t("folderLabel") : t("locationLabel")}</span>
            {editing ? (
              <>
                <div className={styles.folderRow}>
                  <FolderPath path={editing.path} bad={away} />
                  <div className={styles.folderActions}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      // The folder is not there: opening it would only fail.
                      disabled={away}
                      onClick={() => void window.electronAPI.workspaces.openFolder(editing.id)}
                    >
                      {isWindowsHost() ? t("showInExplorerAction") : t("showInFinderAction")}
                    </Button>
                    <Button
                      type="button"
                      // The main fix for a drive letter or mount path that changed.
                      variant={away ? "primary" : "outline"}
                      size="sm"
                      disabled={state.readOnly || relocating}
                      onClick={() => void changeFolder()}
                    >
                      {t("changeFolder")}
                    </Button>
                  </div>
                </div>
                {away && <p className={styles.error}>{t("changeFolderDisconnected")}</p>}
                {folderError && (
                  <p className={styles.error} role="alert">
                    {folderError}
                  </p>
                )}
                <p className={styles.hint}>{t("changeFolderHint")}</p>
                <p className={styles.hint}>{t("editHint")}</p>
              </>
            ) : (
              <LocationSummary
                location={location}
                hasName={validName !== null}
                onUseExisting={onUseExisting}
              />
            )}
          </div>

          {refusal && (
            <p className={styles.error} role="alert">
              {refusalMessage(refusal, editing !== null, t)}
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          <span className={styles.spacer} />
          <div className={styles.actions}>
            <ModalButton variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </ModalButton>
            <ModalButton variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
              {editing ? tc("save") : t("createAction")}
            </ModalButton>
          </div>
        </footer>
      </form>
    </ModalOverlay>
  );
}

function LocationSummary({
  location,
  hasName,
  onUseExisting,
}: {
  location: LocationCheck | null;
  hasName: boolean;
  onUseExisting(): void;
}): React.JSX.Element {
  const t = useTranslations("workspaces");
  const bad = location?.state === "not-empty" || location?.state === "parent-missing";
  return (
    <>
      <div className={styles.folderRow}>
        {hasName && location?.path ? (
          <FolderPath path={location.path} bad={bad} />
        ) : (
          <span className={styles.folderPlaceholder} />
        )}
        <div className={styles.folderActions}>
          {/* Google Drive / OneDrive folders: the folder picker, adopting what is there. */}
          <Button type="button" variant="outline" size="sm" onClick={onUseExisting}>
            {t("useExisting")}
          </Button>
        </div>
      </div>
      <p className={bad ? styles.error : styles.hint}>
        {!hasName
          ? t("locationNeedsName")
          : !location
            ? t("locationChecking")
            : t(
                location.state === "free"
                  ? "locationFree"
                  : location.state === "empty"
                    ? "locationEmpty"
                    : location.state === "not-empty"
                      ? "locationNotEmpty"
                      : "locationParentMissing",
              )}
      </p>
    </>
  );
}

function refusalMessage(
  reason: WorkspaceCreateRefusal | WorkspaceEditRefusal | "create-uncertain" | "edit-uncertain",
  editing: boolean,
  t: ReturnType<typeof useTranslations<"workspaces">>,
): string {
  switch (reason) {
    case "exists":
      return t("locationNotEmpty");
    case "parent-missing":
      return t("locationParentMissing");
    case "name-taken":
      return t("nameTaken");
    case "read-only":
      return t("readOnly");
    case "unknown":
      return t("removeRefusedUnknown");
    case "not-writable":
      return t(editing ? "editNotWritable" : "createNotWritable");
    case "create-uncertain":
      return t("createUncertain");
    case "edit-uncertain":
      return t("editUncertain");
    default:
      return t(editing ? "editFailed" : "createFailed");
  }
}
