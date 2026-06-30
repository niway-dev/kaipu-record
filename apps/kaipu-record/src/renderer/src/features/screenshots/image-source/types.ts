/**
 * The editor's image-source abstraction. The editor (the generic "parent panel")
 * never knows where the bytes live — it consumes a `ResolvedImage`. Each source
 * `kind` is resolved by its own reader, so adding a new origin (cloud, …) is a
 * new reader + a new union member, with the editor untouched.
 */

/** Properties every image source carries, regardless of where its bytes live. */
export interface ImageSourceBase {
  /** Natural pixel size when known (a fresh capture has it; a re-opened item may not). */
  width?: number;
  height?: number;
  /** Optional human title (used when saving). */
  title?: string;
}

/**
 * Where the editor's image comes from — the `kind` discriminator:
 * - `blob`  — a freshly captured PNG held in memory (what capture produces today).
 * - `local` — a screenshot already saved in the vault (offline / local re-open).
 * - `cloud` — a screenshot uploaded to cloud storage (remote URL).
 */
export type ImageSource =
  | (ImageSourceBase & { kind: "blob"; bytes: ArrayBuffer })
  | (ImageSourceBase & { kind: "local"; id: string; version?: number })
  | (ImageSourceBase & { kind: "cloud"; url: string });

/** What every reader resolves a source into, for the generic editor to consume. */
export interface ResolvedImage {
  /** URL for `<img src>` / canvas drawing. */
  displayUrl: string;
  /** The raw PNG bytes — for copy to clipboard, save, and (later) export. */
  getBytes(): Promise<ArrayBuffer>;
}

/**
 * Resolves a single source kind. One implementation per `kind`; the registry in
 * `use-image-source.ts` dispatches to the right one. Add a kind → add a reader.
 */
export interface ImageSourceReader<S extends ImageSource> {
  /** Produce a display URL + optional cleanup (e.g. revoke a `blob:` URL). */
  resolve(source: S): { displayUrl: string; cleanup?: () => void };
  /** Fetch the raw PNG bytes. */
  getBytes(source: S): Promise<ArrayBuffer>;
}
