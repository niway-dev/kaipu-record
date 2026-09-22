/** Pure scene edits for privacy regions (blur / cover). */
import { newId, type VideoScene } from "../scene";
import {
  type BlurRedaction,
  clampIntensity,
  type CoverRedaction,
  type NormRect,
  REDACTION,
  type Redaction,
} from "./redaction";

export function addRedaction(
  scene: VideoScene,
  kind: Redaction["kind"],
  rect: NormRect,
  window: { start: number; end: number },
): { scene: VideoScene; id: string } {
  const id = newId();
  const redaction: Redaction =
    kind === "blur"
      ? {
          id,
          kind,
          start: window.start,
          end: window.end,
          rect,
          intensity: REDACTION.defaultIntensity,
          style: "gaussian",
        }
      : {
          id,
          kind,
          start: window.start,
          end: window.end,
          rect,
          fill: REDACTION.coverFills[0],
          label: "",
        };
  return { scene: { ...scene, redactions: [...scene.redactions, redaction] }, id };
}

export type BlurPatch = Partial<
  Pick<BlurRedaction, "start" | "end" | "rect" | "intensity" | "style">
>;
export type CoverPatch = Partial<Pick<CoverRedaction, "start" | "end" | "rect" | "fill" | "label">>;

export function updateRedaction(
  scene: VideoScene,
  id: string,
  patch: BlurPatch | CoverPatch,
): VideoScene {
  return {
    ...scene,
    redactions: scene.redactions.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch } as Redaction;
      if (next.kind === "blur") next.intensity = clampIntensity(next.intensity);
      return next;
    }),
  };
}

export function removeRedaction(scene: VideoScene, id: string): VideoScene {
  return { ...scene, redactions: scene.redactions.filter((r) => r.id !== id) };
}
