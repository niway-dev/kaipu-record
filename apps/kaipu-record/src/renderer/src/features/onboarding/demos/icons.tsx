import type { ReactElement, ReactNode } from "react";

/**
 * The glyphs of the onboarding demos and cards, drawn on a 24-unit grid with a
 * `currentColor` stroke (ported from the design mock, so the demos and the mock match).
 */
const GLYPHS = {
  video: (
    <>
      <rect x={2} y={6} width={13} height={12} rx={2.4} />
      <path d="M22 8.5l-7 3.5 7 3.5z" />
    </>
  ),
  camera: (
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx={12} cy={13} r={4} />
    </>
  ),
  pen: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  monitor: (
    <>
      <rect x={2} y={3} width={20} height={14} rx={1.8} />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ),
  mic: (
    <>
      <rect x={9} y={2} width={6} height={11} rx={3} />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
    </>
  ),
  webcam: (
    <>
      <circle cx={12} cy={11} r={5.5} />
      <circle cx={12} cy={11} r={2} />
      <path d="M8 20h8" />
      <path d="M12 16.5V20" />
    </>
  ),
  speaker: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  play: <path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none" />,
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 8l5-5 5 5" />
      <path d="M12 3v12" />
    </>
  ),
  film: (
    <>
      <rect x={3} y={4} width={18} height={16} rx={2} />
      <path d="M7 4v16" />
      <path d="M17 4v16" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  select: <path d="M5 3l5.5 16 2.2-6.3 6.3-2.2z" />,
  box: <rect x={4} y={5} width={16} height={14} rx={2.5} />,
  arrow: (
    <>
      <path d="M6 18L18 6" />
      <path d="M9 6h9v9" />
    </>
  ),
  text: (
    <>
      <path d="M5 7V5h14v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </>
  ),
  step: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M10.5 9.5l2-1.5v8" />
    </>
  ),
  ruler: (
    <>
      <path d="M3 12h18" />
      <path d="M3 8v8" />
      <path d="M21 8v8" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  size?: number;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
}: IconProps & { name: IconName }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {GLYPHS[name]}
    </svg>
  );
}

const make = (name: IconName) =>
  function DemoIcon(props: IconProps): ReactElement {
    return <Icon name={name} {...props} />;
  };

/** The icon of each onboarding card. */
export const RecordIcon = make("video");
export const CaptureIcon = make("camera");
export const ShareIcon = make("upload");
export const EditorIcon = make("film");
export const WorkspacesIcon = make("folder");
