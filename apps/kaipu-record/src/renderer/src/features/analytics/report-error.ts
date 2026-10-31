import { showToast } from "@renderer/ui/toast-store";
import { isStaleWorkspaceError } from "@renderer/features/workspaces/stale";
import { captureException } from "./analytics-client";

export interface ReportErrorOptions {
  /** Extra technical context for PostHog (never shown to the user). */
  context?: Record<string, unknown>;
  /** If provided, the toast gets a "Reintentar" action that runs this. */
  retry?: () => void;
}

/**
 * The two-channel error rule, in one call:
 *  - developer channel → full Error (name/message/stack) + context to PostHog
 *  - user channel      → a short, human-readable message in the toast
 * The two never mix: the user message is the ONLY thing the user sees.
 */
export function reportError(
  userMessage: string,
  error: unknown,
  options: ReportErrorOptions = {},
): void {
  // A call answered after a workspace switch: its page is gone and nothing was written.
  if (isStaleWorkspaceError(error)) return;
  captureException(error, options.context);
  showToast({
    message: userMessage,
    action: options.retry ? { label: "Reintentar", onClick: options.retry } : undefined,
  });
}
