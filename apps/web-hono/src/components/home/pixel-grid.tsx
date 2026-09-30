import styles from "./pixel-grid.module.css";

/**
 * The brand's pixel motif — the mark's own pixel-play turned into page texture.
 *
 * The opacities look scattered but come from a fixed seed, for two reasons: the
 * server and the client must render the same grid or React reports a hydration
 * mismatch, and a motif that reshuffled on every visit would stop being a
 * signature. Same reason the design system calls for a fixed seed.
 */
const COLS = 9;
const ROWS = 6;

/** A small deterministic hash — enough scatter, zero randomness. */
function opacityAt(i: number): number {
  const n = (i * 2654435761) % 1000;
  if (n < 380) return 0; // most cells stay empty, so the shape reads as a drift
  return 0.07 + (n % 50) / 100;
}

export function PixelGrid({ className }: { className?: string }) {
  return (
    <div className={`${styles.grid} ${className ?? ""}`} aria-hidden>
      {Array.from({ length: COLS * ROWS }, (_, i) => (
        <span key={i} className={styles.cell} style={{ opacity: opacityAt(i) }} />
      ))}
    </div>
  );
}
