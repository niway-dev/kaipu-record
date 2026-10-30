import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createMainTranslator } from "@kaipu/i18n/main";
import { IPC_CHANNELS } from "@shared/types";
import type {
  WorkspaceAddResult,
  WorkspacePrepareResult,
  WorkspaceRemoveResult,
  WorkspacesState,
  WorkspaceStamp,
  WorkspaceSwitchResult,
  WorkspaceView,
} from "@shared/types/workspaces";
import { getAppSettings } from "../infrastructure/settings-store";
import { LibraryVault } from "../library/library-vault";
import { uuidv7 } from "../library/tag-repository";
import { defaultVaultDirectory, forgetCachedPreferences } from "../library/vault-location";
import { StaleWorkspaceError, WorkspaceGate } from "./gate";
import { WorkspaceRegistry, type WorkspaceEntry } from "./registry";
import { PrepareRequests } from "./prepare-windows";
import { switchWorkspace } from "./switch-transaction";
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
let gate: WorkspaceGate | null = null;

export interface WorkspaceHost {
  /** What is writing into the active workspace (the switch lock). */
  busy(): "recording" | "exporting" | null;
  /** Dismiss the capture toast and drop the retained quiet-capture bytes. */
  dropPendingCaptures(): void;
  /** Re-list every window's library (`library:changed`). */
  broadcastLibraryChanged(): void;
}

let host: WorkspaceHost | null = null;

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
  // The preload reads the stamp once, synchronously, before the page's scripts run, so it
  // is answered from here, before any window can exist.
  ipcMain.on(IPC_CHANNELS.workspacesStampSync, (event) => {
    event.returnValue = workspaceGate().stamp satisfies WorkspaceStamp;
  });
  if (registry.readOnly) {
    console.warn("[workspaces] preferences.json does not parse: running read-only until restart");
  }
}

export function activeWorkspace(): WorkspaceEntry {
  return requireRegistry().active();
}

/** Owns the cloud entries without a workspace id (spec decision 3): only it lists them. */
export function ownsLegacyCloud(): boolean {
  const reg = requireRegistry();
  return reg.active().id === reg.state.legacyCloudOwnerId;
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
  const { availability, id } = await reg.availability(active.id);
  if (workspaceGate().adopt(active.id, id, reg.active().id)) void broadcastState();
  if (availability.state !== "available") throw new WorkspaceNotConnectedError(active.name);
  return reg.active();
}

/** Every workspace whose folder is reachable, for the startup and quit sweeps. */
export async function availableWorkspacePaths(): Promise<string[]> {
  const reg = requireRegistry();
  const paths: string[] = [];
  // A copy: a probe may update an entry (a pending one adopting its folder's id).
  for (const entry of reg.entries().slice()) {
    const { availability } = await reg.availability(entry.id);
    if (availability.state === "available") paths.push(entry.path);
  }
  return paths;
}

async function listState(): Promise<WorkspacesState> {
  const reg = requireRegistry();
  const views: WorkspaceView[] = [];
  for (const entry of reg.entries().slice()) {
    const { availability, id } = await reg.availability(entry.id);
    // A pending active entry that adopted its folder's id: windows must take the new stamp.
    if (workspaceGate().adopt(entry.id, id, reg.active().id)) void broadcastState();
    const count =
      availability.state === "available"
        ? await new LibraryVault(entry.path).countMedia().catch(() => null)
        : null;
    views.push(toWorkspaceView(reg.get(id) ?? entry, availability, count));
  }
  const { activeId, hintDismissedAt } = reg.state;
  return {
    activeId,
    generation: workspaceGate().stamp.generation,
    hintDismissed: hintDismissedAt !== undefined,
    busy: host?.busy() ?? null,
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

async function runSwitch(id: string): Promise<WorkspaceSwitchResult> {
  const reg = requireRegistry();
  const result = await switchWorkspace(
    {
      gate: workspaceGate(),
      activeId: () => reg.active().id,
      isKnown: (candidate) => reg.get(candidate) !== undefined,
      readOnly: () => reg.readOnly,
      availability: (candidate) => reg.availability(candidate),
      busy: () => host?.busy() ?? null,
      prepareWindows: () => prepareRequests.prepare(BrowserWindow.getAllWindows()),
      abortWindows: () => sendToAll(IPC_CHANNELS.workspacesPrepareAbort),
      dropPendingCaptures: () => host?.dropPendingCaptures(),
      persistActive: (target) => reg.setActive(target),
      afterCommit: () => {
        refreshTitles();
        void broadcastState();
        host?.broadcastLibraryChanged();
      },
    },
    id,
  );
  // A refused switch still re-lists, so a LOCKED or NOT CONNECTED menu shows why.
  if (!result.ok) void broadcastState();
  return result;
}

/** Folder picker for Add workspace; initializes or adopts the folder, then switches to it. */
async function addWorkspace(sender: Electron.WebContents): Promise<WorkspaceAddResult> {
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
  const { availability } = await reg.availability(outcome.entry.id);
  // Then make it the active one, through the same transaction as any other switch. A
  // refusal (a recording running) leaves it registered and inactive.
  await runSwitch(outcome.entry.id);
  await broadcastState();
  return { ok: true, workspace: toWorkspaceView(outcome.entry, availability, null) };
}

export function registerWorkspaceHandlers(deps: WorkspaceHost): void {
  host = deps;
  ipcMain.handle(IPC_CHANNELS.workspacesList, () => listState());
  ipcMain.handle(IPC_CHANNELS.workspacesSwitch, (_event, id: unknown) =>
    typeof id === "string" ? runSwitch(id) : { ok: false, reason: "unknown" },
  );
  ipcMain.handle(IPC_CHANNELS.workspacesAdd, (event) => addWorkspace(event.sender));
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
