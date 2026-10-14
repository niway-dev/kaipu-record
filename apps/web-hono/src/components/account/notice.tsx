import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@kaipu/web-ui";

/** A passive message inside the account page. Never a toast: the page shows state, not events. */
export function Notice({
  title,
  detail,
  action,
  tone = "default",
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  tone?: "default" | "destructive";
}) {
  return (
    <Alert variant={tone} role="status">
      <AlertTitle>{title}</AlertTitle>
      {detail ? <AlertDescription>{detail}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}
