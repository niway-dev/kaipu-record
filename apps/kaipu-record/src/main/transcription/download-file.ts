import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, statfs } from "node:fs/promises";

/**
 * The verified single-file download both the model store and the engine store build on
 * (ADR 0062): https only, streamed to disk while hashed, size and SHA-256 checked, cancellable.
 * It writes to the path it is given; staging and the final rename belong to the caller.
 */

export type DownloadErrorCode =
  | "network"
  | "hash-mismatch"
  | "size-mismatch"
  | "cancelled"
  | "insufficient-disk-space"
  | "busy"
  /** The bytes verified but the engine could not be unpacked or does not start (extract, handshake). */
  | "engine-failed-to-start";

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;

  constructor(code: DownloadErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DownloadError";
    this.code = code;
  }
}

export type StatfsImpl = (
  path: string,
) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;

export const defaultStatfs: StatfsImpl = (path) => statfs(path);

/** Production accepts `https:` only; tests may serve from `http://127.0.0.1`. */
export function assertAllowedUrl(raw: string, allowInsecureHttp: boolean): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DownloadError("network", `Invalid download URL: ${raw}`);
  }
  if (url.protocol === "https:") return;
  if (allowInsecureHttp && url.protocol === "http:" && url.hostname === "127.0.0.1") return;
  throw new DownloadError("network", `Refusing a non-https download URL: ${url.origin}`);
}

/** Fails with `insufficient-disk-space` when `dir` has less than `neededBytes` free. */
export async function assertDiskSpace(
  dir: string,
  neededBytes: number,
  label: string,
  statfsImpl: StatfsImpl,
): Promise<void> {
  let free: number;
  try {
    const stats = await statfsImpl(dir);
    free = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // The platform cannot report free space: the download itself will fail on a full disk.
    return;
  }
  if (free < neededBytes) {
    throw new DownloadError(
      "insufficient-disk-space",
      `${label} needs ${Math.ceil(neededBytes)} bytes free, ${free} available.`,
    );
  }
}

export function toDownloadError(
  error: unknown,
  signal: AbortSignal,
  message?: string,
): DownloadError {
  if (error instanceof DownloadError) return error;
  if (signal.aborted) return new DownloadError("cancelled", "The download was cancelled.");
  return new DownloadError("network", message ?? "The download failed.", { cause: error });
}

export function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolveHash(hash.digest("hex")));
  });
}

export interface DownloadFileOptions {
  url: string;
  /** Names the file in error messages. */
  name: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the file. */
  sha256: string;
  /** Where the bytes are written. */
  path: string;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  allowInsecureHttp: boolean;
  onBytes: (bytes: number) => void;
}

/** Downloads one file and fails unless its size and SHA-256 match. Leaves a bad file in place. */
export async function downloadVerifiedFile(options: DownloadFileOptions): Promise<void> {
  const { name, sizeBytes, signal } = options;
  let response: Response;
  try {
    response = await options.fetchImpl(options.url, { signal, redirect: "follow" });
  } catch (error) {
    throw toDownloadError(error, signal, `Could not reach the server for ${name}.`);
  }
  if (response.url) assertAllowedUrl(response.url, options.allowInsecureHttp);
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new DownloadError("network", `The server answered ${response.status} for ${name}.`);
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== sizeBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new DownloadError(
      "size-mismatch",
      `${name} is ${declared} bytes on the server, expected ${sizeBytes}.`,
    );
  }

  const hash = createHash("sha256");
  const handle = await open(options.path, "w");
  let received = 0;
  try {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > sizeBytes) {
          await reader.cancel().catch(() => undefined);
          throw new DownloadError(
            "size-mismatch",
            `${name} is larger than the expected ${sizeBytes} bytes.`,
          );
        }
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
          offset += bytesWritten;
        }
        options.onBytes(value.byteLength);
        if (signal.aborted) throw new DownloadError("cancelled", "The download was cancelled.");
      }
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      throw toDownloadError(error, signal, `The connection dropped while downloading ${name}.`);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (received !== sizeBytes) {
    throw new DownloadError(
      "size-mismatch",
      `${name} is ${received} bytes, expected ${sizeBytes}.`,
    );
  }
  if (hash.digest("hex") !== options.sha256) {
    throw new DownloadError("hash-mismatch", `${name} does not match its pinned SHA-256.`);
  }
}
