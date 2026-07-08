import type { TokenSet } from "../types";
import { dark } from "./dark";

/**
 * PLACEHOLDER — light currently mirrors dark so the two-theme architecture
 * ships without visual change. The real light palette is designed in PR2
 * (see specs/2026-07-07-design-tokens-package-design).
 */
export const light: TokenSet = { ...dark };
