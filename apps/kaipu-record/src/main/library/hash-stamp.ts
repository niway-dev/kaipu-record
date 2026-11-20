/**
 * The stamp that proves a cached content hash still describes the file on disk (NIW2-891).
 *
 * Size and mtime alone can be fooled: a tool that rewrites bytes and restores the mtime
 * (`utimes`, an editor, a sync client) keeps both. The change time (ctime) cannot be set from
 * user space and moves on every write, rename or `utimes`; the inode number moves when a file
 * is replaced by another one. A stamp matches only when all four agree, and a sidecar written
 * before ctime and inode were recorded has no such fields, so it never matches and re-hashes
 * once. The one place that keeps trusting such a legacy stamp on size and mtime is `describe()`
 * (`legacyStampMatches`): it only reports a hash for cloud linking, and a re-hash it cannot
 * trigger must not downgrade every old item to "pending".
 */

/** The fields of a `stat` the stamp reads. */
export interface StatLike {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}

/** The sidecar fields that carry a stamp; every one is optional so old sidecars still parse. */
export interface HashStamp {
  hashedSizeBytes?: number;
  hashedMtimeMs?: number;
  hashedCtimeMs?: number;
  hashedIno?: number;
}

/** The sidecar fields for the file as `info` describes it. */
export function stampFields(info: StatLike): Required<HashStamp> {
  return {
    hashedSizeBytes: info.size,
    hashedMtimeMs: info.mtimeMs,
    hashedCtimeMs: info.ctimeMs,
    hashedIno: info.ino,
  };
}

/** Whether a sidecar's stamp still describes the file `info` stats. Missing fields never match. */
export function stampMatches(stamp: HashStamp, info: StatLike): boolean {
  return (
    stamp.hashedSizeBytes === info.size &&
    stamp.hashedMtimeMs === info.mtimeMs &&
    stamp.hashedCtimeMs === info.ctimeMs &&
    stamp.hashedIno === info.ino
  );
}

/**
 * Whether a stamp written before ctime and inode were recorded (it has neither field at all)
 * still matches `info` on size and mtime, as every stamp did before. A stamp that has either
 * field never takes this path.
 */
export function legacyStampMatches(stamp: HashStamp, info: StatLike): boolean {
  return (
    stamp.hashedCtimeMs === undefined &&
    stamp.hashedIno === undefined &&
    stamp.hashedSizeBytes === info.size &&
    stamp.hashedMtimeMs === info.mtimeMs
  );
}

/** Whether two stats of the same path describe the same file state. */
export function sameStat(a: StatLike, b: StatLike): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;
}
