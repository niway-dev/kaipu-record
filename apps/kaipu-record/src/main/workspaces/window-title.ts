export const APP_TITLE = "Kaipu Record";

/**
 * The main window's title: "Work — Kaipu Record" (or "Work — <the open item>"). The prefix
 * needs a second workspace to mean anything, so with one it is just the page's own title
 * (spec, Switcher and labels).
 */
export function composeWindowTitle(pageTitle: string, workspaceName: string | null): string {
  const page = pageTitle.trim() || APP_TITLE;
  return workspaceName ? `${workspaceName} — ${page}` : page;
}
