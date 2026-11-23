/**
 * What reopening a saved screenshot found beside it (ADR 0053), in canvas mode:
 *
 * - `loaded`: a document that read, validated and has every asset: the editor mounts it, and
 *   says so (`savedAt` is when it was written, null if that could not be read);
 * - `absent`: no document: a plain screenshot, nothing to say;
 * - `unreadable`: a document exists but could not be used (corrupt, unsupported, an asset
 *   missing, or the read failed): the flat PNG opens and the editor says the layers are gone.
 *   `keepStored` is set when the failure says nothing about the document itself (the read or
 *   the stat failed with an I/O error): it may well be intact, so no save may replace it.
 *   `evicted` is set when the sync provider has not downloaded the document (or one of its
 *   assets): nothing is damaged, the file is just not here yet, and it is never read to find out.
 */
export type CanvasLoad<Doc> =
  | { status: "loaded"; doc: Doc; savedAt: number | null }
  | { status: "absent" }
  | { status: "unreadable"; keepStored?: boolean; evicted?: true };

/**
 * When the document beside a shot was last written, or null when no document file exists,
 * or "failed" when the stat itself could not be had. Never rejects.
 */
async function statDocument(id: string): Promise<{ savedAt: number } | null | "failed"> {
  try {
    return (await window.electronAPI.statScreenshotCanvas(id)) ?? null;
  } catch {
    return "failed";
  }
}

/** The saved time of a document that loaded: null when it cannot be told. */
export async function savedAtOf(id: string): Promise<number | null> {
  const stat = await statDocument(id);
  return stat === "failed" ? null : (stat?.savedAt ?? null);
}

/**
 * The reader gave up on a shot (null, or a document it could not use): `unreadable` when a
 * document file is there, `absent` when it is not. The reader answers null for both, so this
 * is the one place the two are told apart. When the stat itself fails the answer is `unknown`:
 * a document may be there and intact, so the editor warns the user and keeps its hands off it.
 */
export async function whyNoDocument(id: string): Promise<"absent" | "unreadable" | "unknown"> {
  const stat = await statDocument(id);
  if (stat === "failed") return "unknown";
  return stat === null ? "absent" : "unreadable";
}

/** Reads that fail for I/O reasons (a cloud placeholder still downloading) often pass a moment later. */
const READ_ATTEMPTS = 3;
const READ_RETRY_MS = 200;

/**
 * Read failures no pause can fix. Only the errno code crosses the IPC boundary, in the message
 * ("canvas document read failed: EACCES"); anything else, including an unknown code, is retried.
 */
const PERMANENT_READ_CODES = /: (EACCES|EPERM|EISDIR|ENOTDIR|EINVAL|ELOOP|ENAMETOOLONG)$/;
function isPermanentReadError(error: unknown): boolean {
  return error instanceof Error && PERMANENT_READ_CODES.test(error.message);
}

/**
 * The document or one of its assets is offloaded by a sync provider (`EVICTED`, from the main
 * side's eviction guard). Not a fault and not transient: the file is not read to find out, and
 * asking again cannot make the provider download it.
 */
const EVICTED_READ_CODE = /: EVICTED$/;
export function isEvictedReadError(error: unknown): boolean {
  return error instanceof Error && EVICTED_READ_CODE.test(error.message);
}

/**
 * Runs `read`, trying again after a short pause when it rejects, up to three attempts in all.
 * A permanent failure (see above) and an offloaded document are rethrown at once. The last rejection is rethrown. A read that resolves (even with null) is never retried.
 */
export async function readWithRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= READ_ATTEMPTS || isPermanentReadError(error) || isEvictedReadError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
    }
  }
}
