import React, { useEffect, useState } from "react";
import { Copy, Info } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@kaipu/ui";
import { ModalActions, ModalButton, ModalOverlay, ModalText, ModalTitle } from "@kaipu/ui";
import {
  FOLDER_OVERRIDE_KEYS,
  type FolderOverrideKey,
  type OverridableKey,
  type ScopedSettings,
  type SettingsOverrides,
} from "@shared/settings-scope";
import { FPS_STEP_LABELS, RESOLUTION_STEP_LABELS } from "@shared/recording-quality";
import type { AppSettings } from "@shared/types";
import { useOptionalWorkspaces } from "@renderer/features/workspaces/workspaces-context";
import { Select } from "@renderer/ui/select";
import { cx } from "@renderer/ui/cx";
import { subscribeSettings } from "@renderer/features/settings/settings-store";
import { useSettingsScope, useScopedSetting, type ScopedSetting } from "./settings-scope";
import styles from "./scope.module.css";

/** "PER WORKSPACE" or "GLOBAL" beside a section's title (the design's scope tag). */
export function ScopeTag({ scope }: { scope: "workspace" | "global" }): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  const { multi } = useSettingsScope();
  // The tag only says something when there is a choice to make: with one workspace nothing
  // "changes with the workspace".
  if (!multi) return null;
  return (
    <span className={cx(styles.tag, styles.scopeBlue)} data-scope={scope}>
      {scope === "workspace" ? t("tagPerWorkspace") : t("tagGlobal")}
    </span>
  );
}

/** "Settings for: Work ▾" at the top of the Settings nav; hidden with a single workspace. */
export function ScopeSelector(): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  const { multi, workspaces, scope, setScope } = useSettingsScope();
  if (!multi) return null;
  const options = [
    { value: "all", label: t("allWorkspaces") },
    ...workspaces.map((ws) => ({
      value: ws.id,
      label: ws.state === "unavailable" ? `${ws.name} · ${t("notConnected")}` : ws.name,
      disabled: ws.state === "unavailable",
    })),
  ];
  return (
    <div className={styles.selector}>
      <span className={styles.selectorLabel} id="settings-scope-label">
        {t("selectorLabel")}
      </span>
      <Select
        className={styles.selectorTrigger}
        aria-label={t("selectorAria")}
        value={scope}
        options={options}
        onChange={setScope}
      />
    </div>
  );
}

/** The blue dot beside a nav item whose page changes with the workspace. */
export function ScopeDot(): React.JSX.Element | null {
  const { multi } = useSettingsScope();
  if (!multi) return null;
  return (
    <span
      className={cx(styles.navDot, styles.scopeBlue)}
      data-testid="scope-dot"
      aria-hidden="true"
    />
  );
}

export function ScopeLegend(): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  const { multi } = useSettingsScope();
  if (!multi) return null;
  return (
    <p className={cx(styles.legend, styles.scopeBlue)}>
      <span className={styles.navDot} style={{ marginLeft: 0 }} aria-hidden="true" />
      {t("legend")}
    </p>
  );
}

/** A title with its scope tag; the header of a page whose keys follow (or not) the workspace. */
export function ScopedTitle({
  scope,
  children,
}: {
  scope: "workspace" | "global";
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className={styles.titleRow}>
      {children}
      <ScopeTag scope={scope} />
    </span>
  );
}

/** Under a per-workspace page's subtitle: whose values these are. */
export function ScopeLine(): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  const { mode, target } = useSettingsScope();
  if (mode === "single") return null;
  return (
    <p className={styles.scopeLine}>
      {mode === "all" ? t("scopeLineAll") : t("scopeLine", { name: target?.name ?? "" })}
    </p>
  );
}

/** Marks a row that edits the All level from every scope (shown only inside a per-workspace page). */
export function AppWideBadge(): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  const { multi } = useSettingsScope();
  if (!multi) return null;
  return <span className={styles.appWide}>{t("appWide")}</span>;
}

interface OverrideRowProps<K extends OverridableKey> {
  settingKey: K;
  /** The value shown until the first read, and the default for a row rendered alone. */
  fallback: AppSettings[K];
  label: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  control(api: {
    value: AppSettings[K];
    onChange(value: AppSettings[K]): void;
    disabled: boolean;
  }): React.ReactNode;
}

/**
 * A row of a setting a workspace may override. It shows where the value comes from ("Set for
 * Work", "Same as default", "Overridden in Work") and carries Copy-to-all and Reset.
 */
export function OverrideRow<K extends OverridableKey>({
  settingKey,
  fallback,
  label,
  description,
  icon,
  control,
}: OverrideRowProps<K>): React.JSX.Element {
  const setting = useScopedSetting(settingKey, fallback);
  return (
    <Row
      icon={icon}
      label={label}
      description={
        <>
          {description}
          <SourceLine setting={setting} />
        </>
      }
      action={
        <span className={styles.actions}>
          {control({
            value: setting.value,
            onChange: (v) => void setting.set(v),
            disabled: setting.disabled,
          })}
          <RowActions setting={setting} label={label} />
        </span>
      }
    />
  );
}

/**
 * A control that is not a one-line row (the quality chips and sliders) with the same source line,
 * Copy-to-all and Reset in a bar above it.
 */
export function OverrideBlock<K extends OverridableKey>({
  settingKey,
  fallback,
  label,
  children,
}: {
  settingKey: K;
  fallback: AppSettings[K];
  label: string;
  children(api: {
    value: AppSettings[K];
    onChange(value: AppSettings[K]): void;
    disabled: boolean;
  }): React.ReactNode;
}): React.JSX.Element {
  const setting = useScopedSetting(settingKey, fallback);
  const showBar =
    setting.mode === "workspace" || setting.overridden || setting.overriddenIn.length > 0;
  return (
    <div>
      {showBar && (
        <div className={styles.blockBar}>
          <span className={styles.blockSource}>
            <SourceLine setting={setting} />
          </span>
          <RowActions setting={setting} label={label} />
        </div>
      )}
      {/* A disabled fieldset turns off every control inside it (chips, sliders). */}
      <fieldset className={styles.fieldset} disabled={setting.disabled}>
        {children({
          value: setting.value,
          onChange: (v) => void setting.set(v),
          disabled: setting.disabled,
        })}
      </fieldset>
    </div>
  );
}

function SourceLine<K extends OverridableKey>({
  setting,
}: {
  setting: ScopedSetting<K>;
}): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  let text: string | null = null;
  if (setting.mode === "workspace") {
    text = setting.overridden ? t("setFor", { name: setting.scopeName ?? "" }) : t("sameAsDefault");
  } else if (setting.mode === "all") {
    text =
      setting.overriddenIn.length > 0
        ? t("overriddenIn", { names: setting.overriddenIn.join(", ") })
        : null;
  } else if (setting.overridden) {
    text = t("setForThis");
  }
  if (!text) return null;
  return (
    <span
      className={cx(styles.source, styles.scopeBlue)}
      data-set={setting.overridden || undefined}
    >
      {text}
    </span>
  );
}

function RowActions<K extends OverridableKey>({
  setting,
  label,
}: {
  setting: ScopedSetting<K>;
  label: string;
}): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  if (setting.mode === "all") return null;
  return (
    <>
      {setting.overridden && (
        <button
          type="button"
          className={cx(styles.bannerLink, styles.scopeBlue)}
          data-quiet="true"
          aria-label={t("resetNamed", { label })}
          disabled={setting.disabled}
          onClick={() => void setting.reset()}
        >
          {t("reset")}
        </button>
      )}
      {setting.mode === "workspace" && (
        <button
          type="button"
          className={styles.iconButton}
          title={t("copyToAll")}
          aria-label={t("copyNamed", { label })}
          disabled={setting.disabled}
          onClick={() => void setting.copyToAll()}
        >
          <Copy size={13} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

/**
 * "N settings here differ from the default" with "Copy all to every workspace" and "Reset to
 * default", for the keys of one page. Hidden when nothing in `keys` is overridden.
 */
export function SectionBanner({
  keys,
}: {
  keys: readonly OverridableKey[];
}): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  const { mode, multi, overriddenKeys, copyToAll, reset, locked } = useSettingsScope();
  const differing = overriddenKeys(keys);
  if (differing.length === 0 || mode === "all") return null;
  return (
    <div className={cx(styles.banner, styles.scopeBlue)} role="status">
      <span className={styles.bannerIcon}>
        <Info size={14} aria-hidden="true" />
      </span>
      <span className={styles.bannerText}>{t("bannerDiffers", { count: differing.length })}</span>
      {multi && (
        <button
          type="button"
          className={styles.bannerLink}
          disabled={locked}
          onClick={() => void copyToAll(differing)}
        >
          {t("bannerCopyAll")}
        </button>
      )}
      <button
        type="button"
        className={styles.bannerLink}
        data-quiet="true"
        disabled={locked}
        onClick={() => void reset(differing)}
      >
        {t("bannerReset")}
      </button>
    </div>
  );
}

/** What a folder's own settings say, for the sheet: "Screenshot copy: Auto". */
function useValueFormatter(): (key: OverridableKey, value: unknown) => string {
  const t = useTranslations("settingsScope");
  const ts = useTranslations("settings");
  return (key, value) => {
    switch (key) {
      case "showBrandBadge":
        return value === true ? t("valueOn") : t("valueOff");
      case "screenshotCopy":
        return value === "auto" ? t("valueAuto") : t("valueManual");
      case "exportQuality":
        return value === "maximum" ? ts("exportQualityMaximum") : ts("exportQualityBalanced");
      case "recordingQuality": {
        const q = value as AppSettings["recordingQuality"];
        return t("valueQuality", {
          resolution: RESOLUTION_STEP_LABELS[q.resolution],
          fps: FPS_STEP_LABELS[q.fps],
        });
      }
      case "uploadMode":
        return value === "automatic"
          ? t("valueUploadAutomatic")
          : value === "manual"
            ? t("valueUploadManual")
            : t("valueUploadLocalOnly");
    }
  };
}

function useKeyLabel(): (key: FolderOverrideKey) => string {
  const ts = useTranslations("settings");
  return (key) => {
    switch (key) {
      case "showBrandBadge":
        return ts("brandBadge");
      case "screenshotCopy":
        return ts("screenshotCopy");
      case "exportQuality":
        return ts("exportQuality");
      case "recordingQuality":
        return ts("recordingQuality");
    }
  };
}

/**
 * "This workspace brings its own settings": every valid key of the folder's file, with the value
 * it would replace, and the two answers (ADR 0034, decision 8). Closing it decides nothing.
 */
export function PendingSheet({
  workspaceName,
  pending,
  all,
  onUse,
  onIgnore,
  onClose,
}: {
  workspaceName: string;
  pending: SettingsOverrides;
  all: AppSettings;
  onUse(): void;
  onIgnore(): void;
  onClose(): void;
}): React.JSX.Element {
  const t = useTranslations("settingsScope");
  const format = useValueFormatter();
  const keyLabel = useKeyLabel();
  const keys = FOLDER_OVERRIDE_KEYS.filter((key) => key in pending);
  return (
    <ModalOverlay onCancel={onClose} labelledBy="pending-settings-title">
      <ModalTitle id="pending-settings-title">
        {t("pendingTitle")} · {workspaceName}
      </ModalTitle>
      <ModalText>{t("pendingBody")}</ModalText>
      <ul className={styles.pendingList}>
        {keys.map((key) => (
          <li key={key}>
            <span className={styles.pendingKey}>{keyLabel(key)}:</span> {format(key, pending[key])}{" "}
            <span className={styles.pendingReplaces}>
              ({t("pendingReplaces", { value: format(key, all[key]) })})
            </span>
          </li>
        ))}
      </ul>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onIgnore}>
          {t("pendingIgnore")}
        </ModalButton>
        <ModalButton variant="primary" onClick={onUse}>
          {t("pendingUse")}
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}

/**
 * On a workspace's page: what the folder's own settings are doing. Pending and ignored files
 * offer the sheet; an unreadable file or a workspace that is not connected explains itself.
 */
export function ScopeNotice(): React.JSX.Element | null {
  const t = useTranslations("settingsScope");
  const { mode, scoped, target, resolvePending } = useSettingsScope();
  const [reviewing, setReviewing] = useState(false);
  const folder = scoped?.folder ?? "none";
  useEffect(() => {
    if (folder !== "pending" && folder !== "ignored") setReviewing(false);
  }, [folder]);
  if (mode === "all" || !scoped) return null;

  let text: string | null = null;
  if (folder === "pending") text = t("pendingStateBody", { name: target?.name ?? "" });
  else if (folder === "ignored") text = t("ignoredState");
  else if (folder === "unreadable") text = t("unreadableState");
  else if (folder === "unavailable") text = t("unavailableState");
  if (!text) return null;
  return (
    <>
      <div className={cx(styles.banner, styles.scopeBlue)} role="status">
        <span className={styles.bannerIcon}>
          <Info size={14} aria-hidden="true" />
        </span>
        <span className={styles.bannerText}>{text}</span>
        {(folder === "pending" || folder === "ignored") && scoped.pending && (
          <button type="button" className={styles.bannerLink} onClick={() => setReviewing(true)}>
            {folder === "pending" ? t("pendingState") : t("ignoredReview")}
          </button>
        )}
      </div>
      {reviewing && scoped.pending && (
        <PendingSheet
          workspaceName={target?.name ?? ""}
          pending={scoped.pending}
          all={scoped.all}
          onClose={() => setReviewing(false)}
          onUse={() => {
            setReviewing(false);
            void resolvePending("use");
          }}
          onIgnore={() => {
            setReviewing(false);
            void resolvePending("ignore");
          }}
        />
      )}
    </>
  );
}

/**
 * Mounted once in the app shell: the first time a workspace with a file of its own settings is
 * active, asks once ("Use them" / "Ignore"). A capture never waits for the answer, and closing
 * the sheet decides nothing (the file stays pending). The answer is remembered per file hash.
 */
export function PendingSettingsHost(): React.JSX.Element | null {
  const workspaces = useOptionalWorkspaces();
  const activeId = workspaces?.state?.activeId ?? null;
  const activeName = workspaces?.active?.name ?? "";
  const [scoped, setScoped] = useState<ScopedSettings | null>(null);
  const [tick, setTick] = useState(0);
  // Closed without an answer: not asked again for this exact file during this session.
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    void window.electronAPI.settingsScope
      .getScoped(activeId)
      .then((next) => {
        if (alive) setScoped(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [activeId, tick, workspaces?.epoch]);

  useEffect(() => {
    const refresh = (): void => setTick((n) => n + 1);
    const off = subscribeSettings(refresh);
    // A sync may land while the app is in the background: look again when it comes back.
    window.addEventListener("focus", refresh);
    return () => {
      off();
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (
    !activeId ||
    !scoped ||
    scoped.scope !== activeId ||
    scoped.folder !== "pending" ||
    !scoped.pending ||
    !scoped.folderSha256 ||
    dismissed === scoped.folderSha256
  ) {
    return null;
  }
  const sha256 = scoped.folderSha256;
  const answer = (decision: "use" | "ignore"): void => {
    void window.electronAPI.settingsScope
      .resolvePending(activeId, decision, sha256)
      .finally(() => setTick((n) => n + 1));
  };
  return (
    <PendingSheet
      workspaceName={activeName}
      pending={scoped.pending}
      all={scoped.all}
      onClose={() => setDismissed(sha256)}
      onUse={() => answer("use")}
      onIgnore={() => answer("ignore")}
    />
  );
}
