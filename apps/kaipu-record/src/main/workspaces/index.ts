import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createMainTranslator } from "@kaipu/i18n/main";
import { IPC_CHANNELS } from "@shared/types";
import type {
  LocationCheck,
  MoveItemRef,
  MoveItemsResult,
  WorkspaceBusy,
  WorkspaceAddResult,
  WorkspaceCreateResult,
  WorkspaceEditResult,
  WorkspaceRelocateResult,
  WorkspacePrepareResult,
  WorkspaceRemoveResult,
  WorkspacesState,
  WorkspaceStamp,
  WorkspaceSwitchResult,
  WorkspaceView,
  SyncProvider,
} from "@shared/types/workspaces";
import {
  getAllLevelSettings,
  getAppSettings,
  notifyOverridesChanged,
  setOverridesSource,
  updateAppSettings,
} from "../infrastructure/settings-store";
import { isOverridableKey, type OverridableKey } from "@shared/settings-scope";
import { dragLedger } from "../library/drag-ledger";
import { LibraryVault } from "../library/library-vault";
import { loadDeviceId } from "../library/tag-repository";
import { vaultActivity } from "../library/vault-activity";
import { refusalOfError, runMoveGroup } from "./move-group";
import { healMoves, moveItem, type MoveSide } from "./move-item";
import { uuidv7 } from "../library/tag-repository";
import { defaultVaultDirectory, forgetCachedPreferences } from "../library/vault-location";
import { StaleWorkspaceError, WorkspaceGate } from "./gate";
import { WorkspaceRegistry, type Availability, type WorkspaceEntry } from "./registry";
import type { CloudScope } from "../cloud/workspace-filter";
import { probeDataless, type EvictionProbe } from "../library/dataless";
import { boundedProbe, scratchRoot, scratchTmp, SyncStates } from "./sync-state";
import { MachineSettingsStore } from "./settings-overrides";
import { WorkspaceSettings } from "./workspace-settings";
import { PrepareRequests } from "./prepare-windows";
import { relocateRefusal, relocateWorkspace } from "./relocate";
import { switchWorkspace, type ActiveTransactionDeps } from "./switch-transaction";
import { APP_TITLE, composeWindowTitle } from "./window-title";
import { toWorkspaceView } from "./workspace-view";

/**
 * Workspaces in the main process (ADR 0032): the registry, the gate every item-scoped call
 * runs through, and the switch transaction with its IPC. `initWorkspaces()` runs once in
 * `app.whenReady`, before any window exists, so the preload can read the stamp at load.
 */

/** How long a window may take to prepare (an unsaved editor waits on the user's answer). */
const PREPARE_TIMEOUT_MS = 120_000;

let registry: WorkspaceRegistry | null = null;
/** Which provider syncs each workspace's folder (spec, Synced folders). */
const syncStates = new SyncStates();
/**
 * Synced workspaces whose last availability check did not answer in time: available under
 * their registered id (an evicted `identity.json` is downloading), but not a move target.
 */
const unverified = new Set<string>();
let gate: WorkspaceGate | null = null;
let workspaceSettings: WorkspaceSettings | null = null;

export interface WorkspaceHost {
  /** What is writing into the active workspace (the switch lock). A move is added here. */
  busy(): "recording" | "exporting" | null;
  /** Dismiss the capture toast and drop the retained quiet-capture bytes. */
  dropPendingCaptures(): void;
  /** Re-list every window's library (`library:changed`). */
  broadcastLibraryChanged(): void;
  /**
   * A move committed: its cloud asset now belongs to `targetId`. Best effort, never awaited
   * by the move (ADR 0033, the cloud step); the library's assignment queue retries it.
   */
  itemMoved?(assetId: string, targetId: string): void;
}

let host: WorkspaceHost | null = null;

/** The group move running now, if any: it holds the switch lock from its first item to its last. */
let moveRun: { stop: boolean } | null = null;

/** What locks the switcher right now. */
function busyNow(): WorkspaceBusy | null {
  return host?.busy() ?? (moveRun ? "moving" : null);
}

function requireRegistry(): WorkspaceRegistry {
  if (!registry) throw new Error("workspaces: not initialized");
  return registry;
}

export function workspaceGate(): WorkspaceGate {
  if (!gate) throw new Error("workspaces: not initialized");
  return gate;
}

export async function initWorkspaces(): Promise<void> {
  registry = await WorkspaceRegistry.open({
    preferencesFile: join(app.getPath("userData"), "preferences.json"),
    defaultDirectory: defaultVaultDirectory(),
    newId: () => uuidv7(),
    onPreferencesWritten: forgetCachedPreferences,
  });
  gate = new WorkspaceGate(registry.active().id);
  // Re-detected on every launch (a folder may have been moved into Drive since).
  await Promise.all(registry.entries().map((entry) => syncStates.refresh(entry)));
  await initWorkspaceSettings(registry);
  // The preload reads the stamp once, synchronously, before the page's scripts run, so it
  // is answered from here, before any window can exist.
  ipcMain.on(IPC_CHANNELS.workspacesStampSync, (event) => {
    event.returnValue = workspaceGate().stamp satisfies WorkspaceStamp;
  });
  if (registry.readOnly) {
    console.warn("[workspaces] preferences.json does not parse: running read-only until restart");
  }
  // A move the app died in is finished before anything lists either workspace.
  await healPendingMoves();
}

/**
 * Per-workspace setting overrides (ADR 0034): the module that owns the two override files, wired
 * to the registry and to the settings store, which resolves the effective settings from it.
 * The active workspace's folder file is read once here, at app start.
 */
async function initWorkspaceSettings(reg: WorkspaceRegistry): Promise<void> {
  const machine = await MachineSettingsStore.open(
    join(app.getPath("userData"), "workspace-settings.json"),
  );
  const settings = new WorkspaceSettings({
    machine,
    workspaces: () => reg.entries().map(({ id, name, path }) => ({ id, name, path })),
    activeId: () => reg.active().id,
    isAvailable: async (id) => (await availabilityOf(id)).availability.state === "available",
    getAll: getAllLevelSettings,
    writeAll: (patch) => {
      updateAppSettings(patch);
    },
    effective: getAppSettings,
    changed: notifyOverridesChanged,
    now: () => Date.now(),
  });
  workspaceSettings = settings;
  setOverridesSource(() => settings.activeOverrides());
  await settings.refresh(reg.active().id);
}

function requireWorkspaceSettings(): WorkspaceSettings {
  if (!workspaceSettings) throw new Error("workspaces: settings not initialized");
  return workspaceSettings;
}

/**
 * Read the active workspace's folder overrides again. A capture calls this as it starts, so a
 * file a sync changed since the last read is inactive for this capture and not applied unasked
 * (ADR 0034, decision 8). A read that fails leaves the overrides inactive.
 */
export async function refreshActiveWorkspaceSettings(): Promise<void> {
  await workspaceSettings?.refresh(requireRegistry().active().id);
}

/**
 * The availability check, bounded for a synced workspace: a provider that does not answer
 * must never hang the switcher, a capture or a move, and the check never lists the provider's
 * root (spec, Availability and Synced folders). Unanswered, a folder that `stat` still sees is
 * available under its registered id, unverified; one that `stat` cannot see is missing.
 */
async function availabilityOf(id: string): Promise<{ availability: Availability; id: string }> {
  const reg = requireRegistry();
  const entry = reg.get(id);
  if (!entry || syncStates.of(entry) === null) return reg.availability(id);
  const answered = await boundedProbe(reg.availability(id), null);
  if (answered) {
    unverified.delete(id);
    return answered;
  }
  const seen = await boundedProbe(
    stat(entry.path).then((info) => info.isDirectory()),
    false,
    1_000,
  );
  if (!seen) return { availability: { state: "unavailable", reason: "missing" }, id };
  unverified.add(id);
  return { availability: { state: "available" }, id };
}

function movesJournalDir(): string {
  return join(app.getPath("userData"), "workspace-moves");
}

/** The folder a workspace of a move lives in now, or null while it is not connected. */
async function resolveMoveSide(side: MoveSide): Promise<string | null> {
  const reg = requireRegistry();
  if (!reg.get(side.workspaceId)) return null;
  const { availability, id } = await availabilityOf(side.workspaceId);
  if (availability.state !== "available") return null;
  // An identity still downloading cannot prove the folder is this workspace: no move yet.
  if (unverified.has(id)) return null;
  return reg.get(id)?.path ?? null;
}

/** A workspace as one side of a move: a synced one stages in its scratch folder (decision 15). */
function moveSideOf(entry: WorkspaceEntry, directory = entry.path): MoveSide {
  return syncStates.of(entry) === null
    ? { workspaceId: entry.id, directory }
    : { workspaceId: entry.id, directory, scratch: scratchRoot(app.getPath("userData"), entry.id) };
}

/**
 * Finish every move the app died in (ADR 0033, decision 6). At startup and before each group.
 * An entry whose workspace is not connected waits for a later run.
 */
async function healPendingMoves(): Promise<void> {
  try {
    const report = await healMoves({ journalDir: movesJournalDir(), resolve: resolveMoveSide });
    if (report.healed > 0) host?.broadcastLibraryChanged();
    if (report.quarantined.length > 0) {
      console.error(
        `[workspaces] ${report.quarantined.length} interrupted move(s) need a look; journal kept in`,
        movesJournalDir(),
      );
    }
  } catch (error) {
    console.error("[workspaces] healing interrupted moves failed", error);
  }
}

let deviceId: Promise<string> | null = null;

/**
 * `workspaces:move-items`: a group of single moves from the active workspace to `targetId`,
 * one after another (ADR 0033, decision 14). Runs inside the workspace gate, so the window's
 * stamp must still be current, and holds the switch lock from the first item to the last.
 */
async function moveItems(
  sender: Electron.WebContents,
  stamp: unknown,
  input: unknown,
): Promise<MoveItemsResult> {
  const reg = requireRegistry();
  const { items: rawItems, targetId } = (input ?? {}) as { items?: unknown; targetId?: unknown };
  const items: MoveItemRef[] = Array.isArray(rawItems)
    ? rawItems.filter(
        (item): item is MoveItemRef =>
          !!item &&
          typeof (item as MoveItemRef).id === "string" &&
          typeof (item as MoveItemRef).assetId === "string",
      )
    : [];
  const target = typeof targetId === "string" ? targetId : "";
  const refuseAll = (reason: MoveItemsResult["failed"][number]["reason"]): MoveItemsResult => ({
    targetId: target,
    moved: [],
    failed: items.map((item) => ({ id: item.id, reason })),
    skipped: [],
  });
  if (moveRun) return refuseAll("busy");
  if (!workspaceGate().isCurrent(stamp)) return refuseAll("stale");
  if (vaultActivity.inMaintenance) return refuseAll("maintenance");

  const run = { stop: false };
  moveRun = run;
  void broadcastState();
  try {
    return await workspaceGate().run(stamp, () =>
      vaultActivity.run("library", async () => {
        await healPendingMoves();
        const source = reg.active();
        // A rejected read is not kept: the next group asks again.
        deviceId ??= loadDeviceId(app.getPath("userData")).catch((error: unknown) => {
          deviceId = null;
          throw error;
        });
        const device = await deviceId;
        const result = await runMoveGroup(
          items,
          async (item) => {
            // Checked per item, when its turn comes (decision 14).
            if (host?.busy()) return { ok: false, reason: "busy" };
            if (target === source.id) return { ok: false, reason: "same-workspace" };
            const entry = reg.get(target);
            if (!entry) return { ok: false, reason: "target-unavailable" };
            const directory = await resolveMoveSide({ workspaceId: target, directory: "" });
            if (directory === null) return { ok: false, reason: "target-unavailable" };
            const outcome = await moveItem(
              {
                source: moveSideOf(source),
                target: moveSideOf(entry, directory),
                id: item.id,
                expectedAssetId: item.assetId,
              },
              { journalDir: movesJournalDir(), deviceId: () => device, dragLedger },
            );
            if (!outcome.ok) return { ok: false, reason: outcome.reason };
            // The local move is committed; the cloud follows, best effort, never blocking it.
            try {
              host?.itemMoved?.(item.assetId, target);
            } catch (error) {
              console.error("[workspaces] could not queue the cloud assignment", error);
            }
            return { ok: true, newId: outcome.newId };
          },
          {
            targetId: target,
            stopped: () => run.stop,
            onProgress: (progress) => {
              if (!sender.isDestroyed()) {
                sender.send(IPC_CHANNELS.workspacesMoveProgress, progress);
              }
            },
          },
        );
        return result;
      }),
    );
  } catch (error) {
    console.error("[workspaces] group move refused", error);
    return refuseAll(refusalOfError(error));
  } finally {
    moveRun = null;
    host?.broadcastLibraryChanged();
    void broadcastState();
  }
}

export function activeWorkspace(): WorkspaceEntry {
  return requireRegistry().active();
}

/**
 * What the cloud filter needs from the registry (`workspace-filter.ts`, decisions 3, 4, 23);
 * the caller adds the pending assignments.
 */
export function cloudScopeBase(): Omit<CloudScope, "pending"> {
  const reg = requireRegistry();
  return {
    activeId: reg.active().id,
    legacyOwnerId: reg.state.legacyCloudOwnerId,
    registered: new Set(reg.entries().map((entry) => entry.id)),
    unassignedHidden: reg.state.cloudAssignedAt !== undefined,
  };
}

/** The first "Assign to workspace…": the unassigned stop showing in the legacy owner. */
export async function markCloudAssigned(): Promise<void> {
  await requireRegistry().markCloudAssigned();
}

/** Every registered workspace, by id, for the cloud page. */
export function registeredWorkspaces(): readonly WorkspaceEntry[] {
  return requireRegistry().entries();
}

/** The provider that syncs a workspace's folder, or null. */
export function workspaceSync(entry: WorkspaceEntry): SyncProvider | null {
  return syncStates.of(entry);
}

/** The active workspace's eviction probe, when it is synced (`LibraryVault`, the media protocol). */
export function activeEvictionProbe(): EvictionProbe | null {
  return syncStates.of(requireRegistry().active()) === null ? null : probeDataless;
}

/** The scratch folder of the active workspace when it is synced, else null. */
export function activeScratch(): string | null {
  const active = requireRegistry().active();
  return syncStates.of(active) === null ? null : scratchRoot(app.getPath("userData"), active.id);
}

/**
 * The scratch staging folder of the workspace registered at `vaultDir`, synced or not (the
 * stranded-take sweep reads it whenever it exists), or null for a folder no workspace holds.
 */
export function scratchStagingFor(vaultDir: string): string | null {
  const entry = requireRegistry()
    .entries()
    .find((candidate) => candidate.path === vaultDir);
  return entry ? scratchTmp(app.getPath("userData"), entry.id) : null;
}

/**
 * Recording staging for a folder (`RecordingWriter.stagingFor`): the scratch folder of the
 * synced workspace that lives there, or null to stage in `.kaipu/tmp/`.
 */
export function syncedStagingFor(vaultDir: string): string | null {
  const entry = requireRegistry()
    .entries()
    .find((candidate) => candidate.path === vaultDir);
  if (!entry || syncStates.of(entry) === null) return null;
  return scratchTmp(app.getPath("userData"), entry.id);
}

/** The workspace's name for a label, only once a second one exists (window title, tray). */
function prefixName(): string | null {
  const reg = requireRegistry();
  return reg.entries().length > 1 ? reg.active().name : null;
}

/** The capture target was unplugged or replaced: refuse, never save anywhere else. */
export class WorkspaceNotConnectedError extends Error {
  constructor(readonly workspaceName: string) {
    const t = createMainTranslator(getAppSettings().locale);
    super(t("workspaces.notConnectedError", { name: workspaceName }));
    this.name = "WorkspaceNotConnectedError";
  }
}

/**
 * The active workspace, checked to be connected, for a capture that is about to start.
 * Throws `WorkspaceNotConnectedError` otherwise; a switch in progress counts as stale.
 */
export async function requireCaptureWorkspace(): Promise<WorkspaceEntry> {
  const reg = requireRegistry();
  if (workspaceGate().switching) throw new StaleWorkspaceError();
  const active = reg.active();
  const { availability, id } = await availabilityOf(active.id);
  if (workspaceGate().adopt(active.id, id, reg.active().id)) void broadcastState();
  if (availability.state !== "available") throw new WorkspaceNotConnectedError(active.name);
  await refreshActiveWorkspaceSettings();
  return reg.active();
}

/** Every workspace whose folder is reachable, for the startup and quit sweeps. */
export async function availableWorkspacePaths(): Promise<string[]> {
  const reg = requireRegistry();
  const paths: string[] = [];
  // A copy: a probe may update an entry (a pending one adopting its folder's id).
  for (const entry of reg.entries().slice()) {
    const { availability } = await availabilityOf(entry.id);
    if (availability.state === "available") paths.push(entry.path);
  }
  return paths;
}

async function listState(): Promise<WorkspacesState> {
  const reg = requireRegistry();
  const views: WorkspaceView[] = [];
  for (const entry of reg.entries().slice()) {
    const { availability, id } = await availabilityOf(entry.id);
    // A pending active entry that adopted its folder's id: windows must take the new stamp.
    if (workspaceGate().adopt(entry.id, id, reg.active().id)) void broadcastState();
    // A synced folder's count is bounded too: `readdir` never downloads, but a stuck
    // provider must not hang the switcher.
    const count =
      availability.state === "available"
        ? await boundedProbe(
            new LibraryVault(entry.path).countMedia().catch(() => null),
            null,
          )
        : null;
    // Which volume the folder is on: "Move to" says whether a move copies or is instant.
    const device =
      availability.state === "available"
        ? await stat(entry.path).then(
            (info) => String(info.dev),
            () => null,
          )
        : null;
    const current = reg.get(id) ?? entry;
    views.push(toWorkspaceView(current, availability, count, device, syncStates.of(current)));
  }
  const { activeId, hintDismissedAt } = reg.state;
  return {
    activeId,
    generation: workspaceGate().stamp.generation,
    hintDismissed: hintDismissedAt !== undefined,
    busy: busyNow(),
    readOnly: reg.readOnly,
    workspaces: views,
  };
}

function sendToAll(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

async function broadcastState(): Promise<void> {
  sendToAll(IPC_CHANNELS.workspacesChanged, await listState());
}

/** The main window's title follows the active workspace and the page's own title. */
export function attachWindowTitle(window: BrowserWindow): void {
  let pageTitle = APP_TITLE;
  const apply = (): void => {
    if (!window.isDestroyed()) window.setTitle(composeWindowTitle(pageTitle, prefixName()));
  };
  window.on("page-title-updated", (event, title) => {
    event.preventDefault();
    pageTitle = title;
    apply();
  });
  titleAppliers.add(apply);
  window.on("closed", () => titleAppliers.delete(apply));
  apply();
}

const titleAppliers = new Set<() => void>();

function refreshTitles(): void {
  for (const apply of titleAppliers) apply();
}

const prepareRequests = new PrepareRequests(IPC_CHANNELS.workspacesPrepare, PREPARE_TIMEOUT_MS);

/** What every change to the active workspace shares: the lock, the windows, the commit. */
function activeTransactionDeps(): ActiveTransactionDeps {
  return {
    gate: workspaceGate(),
    // The group move holds this lock too: a folder cannot change under it.
    busy: busyNow,
    prepareWindows: () => prepareRequests.prepare(BrowserWindow.getAllWindows()),
    abortWindows: () => sendToAll(IPC_CHANNELS.workspacesPrepareAbort),
    dropPendingCaptures: () => host?.dropPendingCaptures(),
    afterCommit: () => {
      // The new workspace's effective settings reach every window and every main listener.
      notifyOverridesChanged();
      refreshTitles();
      void broadcastState();
      host?.broadcastLibraryChanged();
    },
  };
}

async function runSwitch(id: string): Promise<WorkspaceSwitchResult> {
  const reg = requireRegistry();
  const result = await switchWorkspace(
    {
      ...activeTransactionDeps(),
      activeId: () => reg.active().id,
      isKnown: (candidate) => reg.get(candidate) !== undefined,
      readOnly: () => reg.readOnly,
      availability: (candidate) => availabilityOf(candidate),
      persistActive: async (target) => {
        await reg.setActive(target);
        // The target's overrides are read before the switch is certain, so the effective
        // settings are ready the moment it commits. A read that fails leaves them inactive.
        await workspaceSettings?.refresh(target);
      },
    },
    id,
  );
  // A refused switch still re-lists, so a LOCKED or NOT CONNECTED menu shows why.
  if (!result.ok) void broadcastState();
  return result;
}

/** Folder picker for Add workspace; initializes or adopts the folder, then switches to it. */
async function addWorkspace(
  sender: Electron.WebContents,
  request: { activate?: unknown } = {},
): Promise<WorkspaceAddResult> {
  const reg = requireRegistry();
  if (reg.readOnly) return { ok: false, reason: "read-only" };
  const window = BrowserWindow.fromWebContents(sender);
  const t = createMainTranslator(getAppSettings().locale);
  const options: Electron.OpenDialogOptions = {
    title: t("dialogs.addWorkspace"),
    buttonLabel: t("dialogs.addWorkspaceButton"),
    properties: ["openDirectory", "createDirectory"],
  };
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const chosen = picked.filePaths[0];
  if (picked.canceled || !chosen) return { ok: false, reason: "cancelled" };

  const outcome = await reg.add(chosen);
  if (outcome.ok) await syncStates.refresh(outcome.entry);
  if (!outcome.ok) {
    if (outcome.reason !== "read-only") {
      const message = { type: "error" as const, message: t("dialogs.folderUnusable") };
      const detail = t(
        outcome.reason === "unreadable"
          ? "dialogs.workspaceUnreadableDetail"
          : "dialogs.folderUnusableDetail",
      );
      await (window
        ? dialog.showMessageBox(window, { ...message, detail })
        : dialog.showMessageBox({ ...message, detail }));
    }
    return { ok: false, reason: outcome.reason === "read-only" ? "read-only" : "not-writable" };
  }
  // Adding a workspace answers the "New: workspaces" hint too.
  await reg.dismissHint();
  const { availability } = await availabilityOf(outcome.entry.id);
  // An adopted folder may bring its own settings file: read it now, so it shows as pending.
  await workspaceSettings?.refresh(outcome.entry.id);
  // Then make it the active one, through the same transaction as any other switch. A
  // refusal (a recording running) leaves it registered and inactive. "Move to ▸ New
  // workspace…" keeps it inactive: the item goes there, the user stays here.
  if (request.activate !== false) await runSwitch(outcome.entry.id);
  await broadcastState();
  return {
    ok: true,
    workspace: toWorkspaceView(
      outcome.entry,
      availability,
      null,
      null,
      syncStates.of(outcome.entry),
    ),
  };
}

/**
 * New workspace: a new folder next to the Default workspace's, only Kaipu's files in it, then
 * the same switch as any other. A refused switch (a recording running) leaves it registered.
 */
async function createWorkspace(input: unknown): Promise<WorkspaceCreateResult> {
  const reg = requireRegistry();
  const { name, color, activate } = (input ?? {}) as {
    name?: unknown;
    color?: unknown;
    activate?: unknown;
  };
  if (typeof name !== "string") return { ok: false, reason: "invalid-name" };
  if (typeof color !== "string") return { ok: false, reason: "invalid-color" };
  const outcome = await reg.create({ name, color });
  if (!outcome.ok) return outcome;
  await syncStates.refresh(outcome.entry);
  await reg.dismissHint();
  const { availability } = await availabilityOf(outcome.entry.id);
  // "Move to ▸ New workspace…" creates it inactive: the item goes there, the user stays here.
  const switchResult: WorkspaceSwitchResult =
    activate === false ? { ok: true } : await runSwitch(outcome.entry.id);
  await broadcastState();
  return {
    ok: true,
    workspace: toWorkspaceView(
      outcome.entry,
      availability,
      null,
      null,
      syncStates.of(outcome.entry),
    ),
    switchResult,
  };
}

async function editWorkspace(input: unknown): Promise<WorkspaceEditResult> {
  const reg = requireRegistry();
  const { id, name, color } = (input ?? {}) as { id?: unknown; name?: unknown; color?: unknown };
  if (typeof id !== "string") return { ok: false, reason: "unknown" };
  const outcome = await reg.edit(id, {
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof color === "string" ? { color } : {}),
  });
  if (!outcome.ok) return outcome;
  const { availability } = await availabilityOf(outcome.entry.id);
  // The window title shows the active workspace's name, and the tiles show the initials.
  refreshTitles();
  await broadcastState();
  return {
    ok: true,
    workspace: toWorkspaceView(
      outcome.entry,
      availability,
      null,
      null,
      syncStates.of(outcome.entry),
    ),
    savedToFolder: outcome.savedToFolder,
  };
}

function overridableKeys(value: unknown): OverridableKey[] | null {
  if (!Array.isArray(value) || !value.every(isOverridableKey)) return null;
  return value;
}

/** `settings:*` channels for the other levels (ADR 0034). The generic ones stay in settings-store. */
function registerSettingsScopeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.settingsGetScoped, (_event, scope: unknown) =>
    requireWorkspaceSettings().getScoped(typeof scope === "string" ? scope : "all"),
  );
  ipcMain.handle(
    IPC_CHANNELS.settingsSetOverride,
    (_event, workspaceId: unknown, key: unknown, value: unknown) =>
      typeof workspaceId === "string" && isOverridableKey(key)
        ? requireWorkspaceSettings().setOverride(workspaceId, key, value ?? null)
        : { ok: false, reason: "not-overridable" },
  );
  ipcMain.handle(
    IPC_CHANNELS.settingsResetOverrides,
    (_event, workspaceId: unknown, keys: unknown) => {
      const checked = overridableKeys(keys);
      return typeof workspaceId === "string" && checked
        ? requireWorkspaceSettings().resetOverrides(workspaceId, checked)
        : { ok: false, reason: "not-overridable" };
    },
  );
  ipcMain.handle(IPC_CHANNELS.settingsCopyToAll, (_event, workspaceId: unknown, keys: unknown) => {
    const checked = overridableKeys(keys);
    return typeof workspaceId === "string" && checked
      ? requireWorkspaceSettings().copyToAll(workspaceId, checked)
      : { ok: false, reason: "not-overridable" };
  });
  ipcMain.handle(
    IPC_CHANNELS.settingsResolvePending,
    (_event, workspaceId: unknown, decision: unknown, sha256: unknown) =>
      typeof workspaceId === "string" &&
      (decision === "use" || decision === "ignore") &&
      typeof sha256 === "string"
        ? requireWorkspaceSettings().resolvePending(workspaceId, decision, sha256)
        : { ok: false, reason: "nothing-pending" },
  );
}

/**
 * "Change folder…": the native folder picker, then the workspace is pointed at that folder.
 * Relocating never moves or copies files; the rules are in `relocate.ts` and the registry.
 */
async function relocateFolder(
  sender: Electron.WebContents,
  id: unknown,
): Promise<WorkspaceRelocateResult> {
  const reg = requireRegistry();
  const deps = { ...activeTransactionDeps(), registry: reg };
  if (typeof id !== "string") return { ok: false, reason: "unknown" };
  // Locked or read-only: say so now, instead of after the user picked a folder.
  const refused = relocateRefusal(deps, id);
  if (refused) return refused;
  const entry = reg.get(id);
  if (!entry) return { ok: false, reason: "unknown" };

  const window = BrowserWindow.fromWebContents(sender);
  const t = createMainTranslator(getAppSettings().locale);
  const options: Electron.OpenDialogOptions = {
    title: t("dialogs.relocateWorkspace", { name: entry.name }),
    buttonLabel: t("dialogs.relocateWorkspaceButton"),
    // Where it was: a moved folder is usually next to where it used to be.
    defaultPath: dirname(entry.path),
    properties: ["openDirectory", "createDirectory"],
  };
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const chosen = picked.filePaths[0];
  if (picked.canceled || !chosen) return { ok: false, reason: "cancelled" };

  const outcome = await relocateWorkspace(deps, id, chosen);
  if (!outcome.ok) return outcome;
  // The new folder may be a synced one (Google Drive): detect it, and probe it bounded.
  const current = reg.get(outcome.entry.id) ?? outcome.entry;
  await syncStates.refresh(current);
  const { availability } = await availabilityOf(current.id);
  // The active workspace re-lists inside its transaction; any other one only needs the state.
  refreshTitles();
  await broadcastState();
  return {
    ok: true,
    workspace: toWorkspaceView(current, availability, null, null, syncStates.of(current)),
    ...(outcome.unchanged ? { unchanged: true as const } : {}),
  };
}

export function registerWorkspaceHandlers(deps: WorkspaceHost): void {
  host = deps;
  registerSettingsScopeHandlers();
  ipcMain.handle(IPC_CHANNELS.workspacesList, () => listState());
  ipcMain.handle(IPC_CHANNELS.workspacesSwitch, (_event, id: unknown) =>
    typeof id === "string" ? runSwitch(id) : { ok: false, reason: "unknown" },
  );
  ipcMain.handle(IPC_CHANNELS.workspacesAdd, (event, options: unknown) =>
    addWorkspace(event.sender, (options ?? {}) as { activate?: unknown }),
  );
  ipcMain.handle(IPC_CHANNELS.workspacesMoveItems, (event, stamp: unknown, input: unknown) =>
    moveItems(event.sender, stamp, input),
  );
  ipcMain.handle(IPC_CHANNELS.workspacesCancelMove, () => {
    if (moveRun) moveRun.stop = true;
  });
  ipcMain.handle(IPC_CHANNELS.workspacesCreate, (_event, input: unknown) => createWorkspace(input));
  ipcMain.handle(IPC_CHANNELS.workspacesEdit, (_event, input: unknown) => editWorkspace(input));
  ipcMain.handle(IPC_CHANNELS.workspacesRelocate, (event, id: unknown) =>
    relocateFolder(event.sender, id),
  );
  ipcMain.handle(
    IPC_CHANNELS.workspacesCheckLocation,
    (_event, name: unknown): Promise<LocationCheck> =>
      typeof name === "string"
        ? requireRegistry().checkNewLocation(name)
        : Promise.resolve({ path: null, state: "parent-missing" }),
  );
  ipcMain.handle(
    IPC_CHANNELS.workspacesRemove,
    async (_event, id: unknown): Promise<WorkspaceRemoveResult> => {
      if (typeof id !== "string") return { ok: false, reason: "unknown" };
      const result = await requireRegistry().remove(id);
      if (result.ok) {
        refreshTitles();
        await broadcastState();
      }
      return result;
    },
  );
  ipcMain.handle(IPC_CHANNELS.workspacesOpenFolder, async (_event, id: unknown) => {
    const entry = typeof id === "string" ? requireRegistry().get(id) : undefined;
    if (!entry) return;
    // shell.openPath never creates the folder: a missing one reports an error string.
    const error = await shell.openPath(entry.path);
    if (error) console.error("failed to open the workspace folder", error);
  });
  ipcMain.handle(IPC_CHANNELS.workspacesDismissHint, async () => {
    await requireRegistry().dismissHint();
    await broadcastState();
  });
  ipcMain.on(IPC_CHANNELS.workspacesPrepareResult, (_event, result: WorkspacePrepareResult) => {
    if (!result || typeof result.requestId !== "number") return;
    prepareRequests.answer(result.requestId, result.ok === true);
  });
}

/** Re-list the switcher in every window (the lock changed: a take started or ended). */
export function notifyWorkspaceBusyChanged(): void {
  if (registry && gate) void broadcastState();
}
