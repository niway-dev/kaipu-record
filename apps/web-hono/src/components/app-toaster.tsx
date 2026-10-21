import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster } from "sonner";

/**
 * The app's toast host, mounted by `AppShell` only.
 *
 * It mirrors `Toaster` from `@kaipu/web-ui` (same icons, popover colors and
 * `cn-toast` class) but talks to `sonner` directly: web-ui ships as one prebuilt
 * bundle, so importing anything from it puts the whole package in the chunk. The
 * app has no `next-themes` provider, so the theme web-ui read was always its
 * "system" default, which is what is passed here.
 */
export function AppToaster() {
  return (
    <Toaster
      richColors
      theme="system"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: "cn-toast" } }}
    />
  );
}
