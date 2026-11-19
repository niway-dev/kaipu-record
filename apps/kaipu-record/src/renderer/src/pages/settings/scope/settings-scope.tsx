import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "@kaipu/i18n";
import type {
  CopyToAllResult,
  OverridableKey,
  ResolvePendingResult,
  ScopedSettings,
  SetOverrideResult,
  SettingsScope,
} from "@shared/settings-scope";
import type { AppSettings } from "@shared/types";
import type { WorkspaceView } from "@shared/types/workspaces";
import { useOptionalWorkspaces } from "@renderer/features/workspaces/workspaces-context";
import { showToast } from "@renderer/ui/toast-store";
import { useAppSettings } from "../use-app-settings";
import { subscribeSettings } from "@renderer/features/settings/settings-store";

/**
 * Where a Settings control writes (ADR 0034, decision 6):
 * - `workspace`: two or more workspaces and one is selected. The row shows that workspace's
 *   value and edits its override.
 * - `all`: two or more workspaces and "All workspaces" is selected. The row shows the default
 *   and edits the All level.
 * - `single`: one workspace, so no selector. The row still reads the active workspace's overrides
 *   (an override survives the removal of the other workspace, and travels with an adopted
 *   folder): a key with an override edits it, a key without edits the All level, as before.
 */
export type ScopeMode = "workspace" | "all" | "single";

export interface SettingsScopeState {
  mode: ScopeMode;
  /** Two or more workspaces: the selector and the scope labels are shown. */
  multi: boolean;
  workspaces: readonly WorkspaceView[];
  /** What the selector shows: "all" or a workspace id. In `single` mode, the active id. */
  scope: SettingsScope;
  setScope(scope: SettingsScope): void;
  /** The scoped read for the current scope; null until the first answer. */
  scoped: ScopedSettings | null;
  /** The workspace the page is about (the selected one, or the active one), if any. */
  target: WorkspaceView | null;
  /** The workspace's own settings cannot be edited right now (pending, unreadable, not connected). */
  locked: boolean;
  setValue<K extends OverridableKey>(key: K, value: AppSettings[K]): Promise<void>;
  reset(keys: readonly OverridableKey[]): Promise<void>;
  copyToAll(keys: readonly OverridableKey[]): Promise<void>;
  resolvePending(decision: "use" | "ignore"): Promise<void>;
  /** The keys of `keys` that the scope's workspace overrides. */
  overriddenKeys(keys: readonly OverridableKey[]): OverridableKey[];
}

const ScopeContext = createContext<SettingsScopeState | null>(null);

function useScopeState(enabled: boolean): SettingsScopeState {
  const t = useTranslations("settingsScope");
  const workspacesContext = useOptionalWorkspaces();
  const workspaces = useMemo(
    () => workspacesContext?.state?.workspaces ?? [],
    [workspacesContext?.state?.workspaces],
  );
  const activeId = workspacesContext?.state?.activeId ?? null;
  const multi = workspaces.length > 1;

  // The user's pick; null follows the active workspace, so a switch moves the page with it.
  const [picked, setPicked] = useState<SettingsScope | null>(null);
  const pickedExists = picked === "all" || workspaces.some((ws) => ws.id === picked);
  const scope: SettingsScope = multi
    ? picked && pickedExists
      ? picked
      : (activeId ?? "all")
    : (activeId ?? "all");
  const mode: ScopeMode = !multi ? "single" : scope === "all" ? "all" : "workspace";

  const [scoped, setScoped] = useState<ScopedSettings | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    // Single mode with no known active workspace (a row rendered alone): nothing to read.
    if (scope === "all" && mode === "single") return;
    let alive = true;
    void window.electronAPI.settingsScope
      .getScoped(scope)
      .then((next) => {
        if (alive) setScoped(next);
      })
      .catch((error: unknown) => console.error("settings: scoped read failed", error));
    return () => {
      alive = false;
    };
  }, [enabled, scope, mode, tick, workspaces]);

  // A change from any window (an override written, an answer, a switch) reads the scope again.
  useEffect(() => {
    if (!enabled) return;
    return subscribeSettings(() => refresh());
  }, [enabled, refresh]);

  const target = useMemo(
    () => (scope === "all" ? null : (workspaces.find((ws) => ws.id === scope) ?? null)),
    [scope, workspaces],
  );
  const scopeIsCurrent = scoped?.scope === scope;
  const folder = scopeIsCurrent ? scoped.folder : "none";
  const locked =
    mode !== "all" &&
    (folder === "pending" ||
      folder === "unreadable" ||
      folder === "unavailable" ||
      target?.state === "unavailable");

  const explain = useCallback(
    (reason: string) => {
      const message =
        reason === "pending"
          ? t("refusedPending")
          : reason === "unreadable"
            ? t("refusedUnreadable")
            : reason === "unavailable"
              ? t("refusedUnavailable")
              : t("saveFailed");
      showToast({ message });
    },
    [t],
  );

  const afterWrite = useCallback(
    (result: SetOverrideResult | CopyToAllResult | ResolvePendingResult): boolean => {
      refresh();
      if (result.ok) return true;
      explain(result.reason);
      return false;
    },
    [explain, refresh],
  );

  const overriddenKeys = useCallback(
    (keys: readonly OverridableKey[]): OverridableKey[] =>
      scopeIsCurrent && mode !== "all" ? keys.filter((key) => key in scoped.overrides) : [],
    [mode, scoped, scopeIsCurrent],
  );

  const setValue = useCallback(
    async <K extends OverridableKey>(key: K, value: AppSettings[K]): Promise<void> => {
      const editsOverride =
        mode === "workspace" || (mode === "single" && scopeIsCurrent && key in scoped.overrides);
      if (editsOverride) {
        afterWrite(await window.electronAPI.settingsScope.setOverride(scope, key, value));
        return;
      }
      // The All level, straight through IPC: every window follows the `settings:changed` it causes,
      // and this hook keeps no settings state of its own (so a provider costs one read, not one
      // per component that uses it).
      await window.electronAPI.updateSettings({ [key]: value } as Partial<AppSettings>);
      refresh();
    },
    [afterWrite, mode, refresh, scope, scoped, scopeIsCurrent],
  );

  const reset = useCallback(
    async (keys: readonly OverridableKey[]): Promise<void> => {
      if (scope === "all" || keys.length === 0) return;
      afterWrite(await window.electronAPI.settingsScope.resetOverrides(scope, keys));
    },
    [afterWrite, scope],
  );

  const copyToAll = useCallback(
    async (keys: readonly OverridableKey[]): Promise<void> => {
      if (scope === "all" || keys.length === 0) return;
      const result = await window.electronAPI.settingsScope.copyToAll(scope, keys);
      if (!afterWrite(result) || !result.ok) return;
      showToast({
        message:
          result.keptOwn.length > 0
            ? t("copiedKept", { names: result.keptOwn.join(", "), count: result.keptOwn.length })
            : t("copied"),
      });
    },
    [afterWrite, scope, t],
  );

  const resolvePending = useCallback(
    async (decision: "use" | "ignore"): Promise<void> => {
      const sha256 = scopeIsCurrent ? scoped.folderSha256 : null;
      if (scope === "all" || !sha256) return;
      const result = await window.electronAPI.settingsScope.resolvePending(scope, decision, sha256);
      if (!result.ok && result.reason === "changed") {
        showToast({ message: t("pendingChanged") });
        refresh();
        return;
      }
      afterWrite(result);
    },
    [afterWrite, refresh, scope, scoped, scopeIsCurrent, t],
  );

  return {
    mode,
    multi,
    workspaces,
    scope,
    setScope: setPicked,
    scoped: scopeIsCurrent ? scoped : null,
    target,
    locked,
    setValue,
    reset,
    copyToAll,
    resolvePending,
    overriddenKeys,
  };
}

/** Provides one scope to every page of the Settings layout (the selector at its top picks it). */
export function SettingsScopeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const state = useScopeState(true);
  return <ScopeContext.Provider value={state}>{children}</ScopeContext.Provider>;
}

/** The scope of the current Settings layout; a page rendered alone gets its own (single mode). */
export function useSettingsScope(): SettingsScopeState {
  const shared = useContext(ScopeContext);
  const own = useScopeState(shared === null);
  return shared ?? own;
}

export interface ScopedSetting<K extends OverridableKey> {
  value: AppSettings[K];
  set(value: AppSettings[K]): Promise<void>;
  mode: ScopeMode;
  /** The row's value comes from an override of the scope's workspace. */
  overridden: boolean;
  /** In the All scope: the names of the workspaces that override this key. */
  overriddenIn: string[];
  scopeName: string | null;
  /** Editing is off (pending review, unreadable file, not connected). */
  disabled: boolean;
  reset(): Promise<void>;
  copyToAll(): Promise<void>;
}

/** One overridable setting as the Settings page shows it: its value, its source, its writers. */
export function useScopedSetting<K extends OverridableKey>(
  key: K,
  fallback: AppSettings[K],
): ScopedSetting<K> {
  const state = useSettingsScope();
  const { settings } = useAppSettings();
  // Read only for the row's own value in `single` mode; the scoped read answers the rest.
  const { scoped, mode } = state;
  const value =
    mode === "all" && scoped
      ? scoped.all[key]
      : mode === "workspace" && scoped
        ? scoped.effective[key]
        : (settings?.[key] ?? fallback);
  const overridden = mode !== "all" && scoped !== null && key in scoped.overrides;
  const latest = useRef(state);
  latest.current = state;
  return {
    value,
    mode,
    overridden,
    overriddenIn: mode === "all" ? (scoped?.overriddenIn[key] ?? []) : [],
    scopeName: state.target?.name ?? null,
    disabled: state.locked,
    set: (next) => latest.current.setValue(key, next),
    reset: () => latest.current.reset([key]),
    copyToAll: () => latest.current.copyToAll([key]),
  };
}
