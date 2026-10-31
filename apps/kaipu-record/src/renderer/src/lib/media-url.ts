import { mediaUrl as buildMediaUrl, type MediaKind } from "@shared/media-url";

export type { MediaKind };

/**
 * A `kaipu-media://` URL for an item of the workspace this window is in. The protocol
 * handler answers 404 for a URL whose `w` is not the active workspace, so a URL kept past a
 * switch never resolves another workspace's item with the same id (ADR 0032). Every
 * renderer-built media URL goes through here (a test pins it); the id is encoded by the
 * shared builder, since a vault id is a title and may hold `#`, `?` or `%` (NIW2-560).
 */
export function mediaUrl(kind: MediaKind, id: string, params: Record<string, string> = {}): string {
  const workspaceId = window.electronAPI?.workspaces?.activeId?.() ?? null;
  return buildMediaUrl(kind, id, workspaceId ? { ...params, w: workspaceId } : params);
}
