/** The hero's states: the brand overview, then one per step of the product. */
export const HERO_MODES = ["overview", "record", "screenshot", "edit", "export"] as const;
export type HeroMode = (typeof HERO_MODES)[number];

/** A step of the product: every mode but the resting `overview`. */
export type HeroStep = Exclude<HeroMode, "overview">;

/** How long each step of the auto demo stays before the next one starts. */
export const AUTO_STEP_MS = 10_000;

/**
 * The auto demo's order: Overview, Record, Screenshot, Edit, Export, then back
 * to the Overview. It is the picker's own order, so the tabs read left to right.
 */
export function nextMode(mode: HeroMode): HeroMode {
  return HERO_MODES[(HERO_MODES.indexOf(mode) + 1) % HERO_MODES.length]!;
}
