import type { CSSProperties } from "react";

import { LOGO_SRC, type LogoUse } from "./index";

export interface KaipuLogoProps {
  /** What this logo is FOR, not which artwork to draw — see LOGO_USES. */
  use: LogoUse;
  /** Rendered edge length in px. Square by construction. */
  size?: number;
  className?: string;
  /**
   * Accessible name. Omit it wherever the logo sits next to the word "Kaipu"
   * or inside a labelled control: the mark is then decoration, and announcing
   * it again is noise for a screen reader.
   */
  alt?: string;
  style?: CSSProperties;
}

/**
 * The Kaipu lockup, shared by the desktop app and the web.
 *
 * A raster rather than a vector: every cut has a coloured, rounded background,
 * and no SVG export exists. The sources are 778px square against a largest real
 * use of about 50px, so there is headroom on any display. When vectors arrive,
 * only LOGO_SRC changes and no caller moves.
 *
 * The corner radius is proportional (22% of the edge) because the artwork's own
 * rounding scales with it; a fixed radius clips at 16px and looks square at 64.
 */
export function KaipuLogo({
  use,
  size = 24,
  className,
  alt,
  style,
}: KaipuLogoProps): React.JSX.Element {
  return (
    <img
      src={LOGO_SRC[use]}
      width={size}
      height={size}
      alt={alt ?? ""}
      aria-hidden={alt ? undefined : true}
      className={className}
      style={{ borderRadius: size * 0.22, display: "block", ...style }}
    />
  );
}
