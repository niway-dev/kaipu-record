import logoUrl from "@renderer/assets/brand/kaipu-logo.png";

/**
 * The Kaipu app lockup — the fox in its pink frame — wherever the app states its
 * own identity: the sidebar, the capture panel header, onboarding, the auth page.
 *
 * A raster, not an SVG, and deliberately: the lockup has a coloured background
 * and no vector export exists yet, so this is the artwork the owner approved
 * rather than a redraw of it. The source is 778px square and it renders at
 * 16–36px, so there is plenty of detail for any display. Swap it for an SVG the
 * moment one exists — nothing but this file's import has to change.
 *
 * Replaces KaipuMark, the older play-arrow glyph, which stays only where a
 * single-colour silhouette is required (the recording watermark, the tray).
 */
export function KaipuLogo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={className}
      style={{ borderRadius: size * 0.22, display: "block" }}
    />
  );
}
