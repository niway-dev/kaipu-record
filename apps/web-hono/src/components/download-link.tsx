import type { AnchorHTMLAttributes } from "react";

import { ANALYTICS_EVENTS, track, type DownloadPlacement } from "@/lib/analytics";
import { platformForUrl } from "@/lib/download";

type DownloadLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  /** Where on the site the link sits; becomes the `placement` property of `download_clicked`. */
  placement: DownloadPlacement;
};

/**
 * An installer link that reports `download_clicked`. The event is fire and forget, so the browser's
 * own navigation to the file never waits on it.
 */
export function DownloadLink({ href, placement, onClick, ...rest }: DownloadLinkProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        const platform = platformForUrl(href);
        if (platform) track(ANALYTICS_EVENTS.downloadClicked, { platform, placement });
      }}
    />
  );
}
