/**
 * A media URL stamped for another workspace (`?w=<id>`): one cached before a switch must
 * never resolve an item with the same id in the active one (ADR 0032). Applies to every
 * kind of URL (recording, screenshot, thumb). A URL with no `w` is not refused here; the
 * ones the app builds all carry it (`LibraryVault.describe`, the renderer's `mediaUrl`).
 */
export function isForeignWorkspaceUrl(url: URL, activeWorkspaceId: string): boolean {
  const workspace = url.searchParams.get("w");
  return workspace !== null && workspace !== activeWorkspaceId;
}
