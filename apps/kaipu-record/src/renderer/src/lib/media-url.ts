export type MediaKind = "recording" | "screenshot" | "thumb";

/**
 * A `kaipu-media://` URL for an item of the workspace this window is in. The protocol
 * handler answers 404 for a URL whose `w` is not the active workspace, so a URL kept past a
 * switch never resolves another workspace's item with the same id (ADR 0032). Every
 * renderer-built media URL goes through here (a test pins it).
 */
export function mediaUrl(kind: MediaKind, id: string, params: Record<string, string> = {}): string {
  const workspaceId = window.electronAPI?.workspaces?.activeId?.() ?? null;
  const query = new URLSearchParams(workspaceId ? { ...params, w: workspaceId } : params);
  const base = `kaipu-media://${kind}/${encodeURIComponent(id)}`;
  return query.size > 0 ? `${base}?${query}` : base;
}
