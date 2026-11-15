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
 */
export type CanvasLoad<Doc> =
  | { status: "loaded"; doc: Doc; savedAt: number | null }
  | { status: "absent" }
  | { status: "unreadable"; keepStored?: boolean };

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
 * Runs `read`, trying again after a short pause when it rejects, up to three attempts in all.
 * The last rejection is rethrown. A read that resolves (even with null) is never retried.
 */
export async function readWithRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= READ_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
    }
  }
}
