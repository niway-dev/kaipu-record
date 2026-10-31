import {
  Archive,
  Ellipsis,
  Mail,
  MessageCircle,
  Smartphone,
  Square,
  SquareCode,
  TvMinimalPlay,
  type LucideIcon,
} from "lucide-react";
import type { DestinationId } from "../destinations";
import styles from "./destination-logo.module.css";

const ICONS: Record<DestinationId | "more", LucideIcon> = {
  youtube: TvMinimalPlay,
  vertical: Smartphone,
  square: Square,
  github: SquareCode,
  chat: MessageCircle,
  email: Mail,
  archive: Archive,
  more: Ellipsis,
};

/**
 * A destination's tile: a generic icon on the platform's colour, so the list reads at a
 * glance without shipping brand marks.
 */
export function DestinationLogo({
  destination,
  size = 32,
}: {
  destination: DestinationId | "more";
  size?: number;
}): React.JSX.Element {
  const Icon = ICONS[destination];
  return (
    <span
      className={styles.logo}
      data-destination={destination}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.9} />
    </span>
  );
}
