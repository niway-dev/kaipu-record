/**
 * Which vault items are open in the video editor right now, by window (NIW2-560).
 *
 * The video editor holds its source id for its whole lifetime (edit-session autosave,
 * cursor track, `kaipu-media://` source URL), so a rename while it is open would send
 * its next session save to the old companion paths. ADR 0032 makes "no rename while
 * the item is open in the editor" an invariant; this registry is how main enforces it,
 * whatever surface (a Library toast's Retry included) asks for the rename.
 *
 * Pure, no Electron: the IPC wiring lives in `./index.ts`.
 */
/** The slice of Electron's WebContents the registry listens to (a fake emitter in tests). */
export interface EditorOwner {
  id: number;
  once(event: "destroyed", listener: () => void): unknown;
  on(event: "render-process-gone", listener: () => void): unknown;
  on(
    event: "did-start-navigation",
    listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void,
  ): unknown;
}

interface Held {
  id: string;
  assetId: string;
}

export class EditorSessions {
  /** Owner (webContents id) → the sessions it holds; a list, so two opens count twice. */
  private readonly byOwner = new Map<number, Held[]>();
  /**
   * Owner → how many times it was released (navigated, reloaded, destroyed). A request
   * captures it on arrival; a hold whose owner was released meanwhile is refused, so no
   * hold outlives the page that asked for it. Never deleted: a reset would let a stale
   * request match again.
   */
  private readonly generations = new Map<number, number>();
  private readonly watched = new Set<number>();

  /**
   * Release everything a window holds whenever its page goes away: destroyed, its renderer
   * crashed (`render-process-gone` keeps the WebContents, so nothing else would release),
   * or a main-frame navigation (a reload unmounts nothing). Each release also bumps the
   * generation, so an acquisition still queued for that page is refused. Once per window.
   */
  watch(owner: EditorOwner): void {
    const id = owner.id;
    if (this.watched.has(id)) return;
    this.watched.add(id);
    owner.once("destroyed", () => {
      this.releaseOwner(id);
      this.watched.delete(id);
    });
    owner.on("render-process-gone", () => this.releaseOwner(id));
    owner.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.releaseOwner(id);
    });
  }

  generation(owner: number): number {
    return this.generations.get(owner) ?? 0;
  }

  /** `open`, unless the owner was released since `generation` was read. Resolves whether it held. */
  openIfCurrent(owner: number, generation: number, id: string, assetId: string): boolean {
    if (generation !== this.generation(owner)) return false;
    this.open(owner, id, assetId);
    return true;
  }

  open(owner: number, id: string, assetId: string): void {
    const held = this.byOwner.get(owner) ?? [];
    held.push({ id, assetId });
    this.byOwner.set(owner, held);
  }

  close(owner: number, id: string): void {
    const held = this.byOwner.get(owner);
    if (!held) return;
    const index = held.findIndex((h) => h.id === id);
    if (index !== -1) held.splice(index, 1);
    if (held.length === 0) this.byOwner.delete(owner);
  }

  /** Everything a window held: it was closed, reloaded or crashed without unmounting. */
  releaseOwner(owner: number): void {
    this.byOwner.delete(owner);
    this.generations.set(owner, this.generation(owner) + 1);
  }

  isOpen(id: string, assetId: string): boolean {
    for (const held of this.byOwner.values()) {
      if (held.some((h) => h.id === id || h.assetId === assetId)) return true;
    }
    return false;
  }
}
