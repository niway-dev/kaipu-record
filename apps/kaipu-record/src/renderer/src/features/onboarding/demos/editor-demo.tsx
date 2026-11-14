import type { ReactElement } from "react";
import { createElement as E } from "react";
import { useDemoText } from "./demo-text";
import { A, DemoLayout, TH, ab, an, createScene, ctr, mono } from "./scene";
import { createTimeline } from "./timeline";

const T = 13;
const P = "e";
/**
 * Second shown under reduced motion: the privacy blur and its timeline segment are on, the
 * zoom has settled back to 1x, the cursor is nearly done moving, and the arrow has not landed.
 */
const FROZEN_AT = 8.5;

const x = (t: number): number => 40 + (t / T) * 580;
const w = (a: number, b: number): number => x(b) - x(a);

export function EditorDemo({ reducedMotion }: { reducedMotion: boolean }): ReactElement {
  const t = useDemoText();
  const tl = createTimeline({ frozenAt: reducedMotion ? FROZEN_AT : undefined });
  const { K, vis, cursor, stage, beats } = createScene(tl);

  const sec = (a: number, b: number, label: string, tint: string) =>
    ab(
      x(a) + 1,
      184,
      w(a, b) - 2,
      16,
      {
        ...mono(8.5, TH.tx, { letterSpacing: ".1em", borderRadius: 4, background: tint }),
        ...ctr,
      },
      label,
    );

  return (
    <DemoLayout
      id="editor"
      tl={tl}
      stage={stage(
        P,
        T,
        ab(
          190,
          12,
          280,
          152,
          {
            borderRadius: 8,
            overflow: "hidden",
            background: "#fff",
            boxShadow: "0 16px 40px -18px rgba(0,0,0,.9)",
          },
          an(
            0,
            0,
            280,
            152,
            { transformOrigin: "82% 18%" },
            K(
              `${P}zm`,
              T,
              [
                [0, "transform:scale(1)"],
                [3.2, "transform:scale(1.9)"],
                [5.6, "transform:scale(1.9)"],
                [6.2, "transform:scale(1)"],
              ],
              { tr: 0.6 },
            ),
            ab(0, 0, 50, 152, { background: "#111827" }),
            ab(64, 16, 70, 9, { borderRadius: 3, background: "#111827" }),
            ab(204, 12, 62, 20, { borderRadius: 5, background: A }),
            ...[0, 1, 2].map((i) =>
              ab(
                64,
                48 + i * 32,
                202,
                22,
                { borderRadius: 5, background: "#f6f7f9", border: "1px solid #e5e7eb" },
                ab(8, 7, 90 + i * 20, 6, { borderRadius: 3, background: "#94a3b8" }),
              ),
            ),
            an(
              62,
              78,
              206,
              26,
              {
                backdropFilter: "blur(5px)",
                WebkitBackdropFilter: "blur(5px)",
                background: "rgba(200,200,206,.5)",
                borderRadius: 4,
              },
              vis(`${P}bl`, T, 6.6, 9.1),
            ),
            an(
              64,
              28,
              80,
              16,
              { color: A, fontWeight: 700, fontSize: 12 },
              vis(`${P}tx`, T, 0.7, 2.3, true),
              t("edAnnotation"),
            ),
            an(
              140,
              108,
              70,
              34,
              null,
              vis(`${P}ar`, T, 9.7, 12.2, true),
              E(
                "svg",
                { width: 70, height: 34, style: { overflow: "visible" } },
                E("path", {
                  d: "M66 30 C 46 30, 28 22, 8 8",
                  style: { stroke: A },
                  strokeWidth: 3,
                  fill: "none",
                  strokeLinecap: "round",
                }),
                E("path", {
                  d: "M20 6 L6 6 L10 20",
                  style: { stroke: A },
                  strokeWidth: 3,
                  fill: "none",
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                }),
              ),
            ),
          ),
        ),
        ab(24, 174, 612, 150, {
          borderRadius: 10,
          background: "#060607",
          border: "1px solid rgba(255,255,255,.08)",
        }),
        sec(0, 3.2, t("edSectionIntro"), "rgba(255,255,255,.1)"),
        sec(3.2, 9.4, t("edSectionDemo"), "rgba(246,5,92,.3)"),
        sec(9.4, 13, t("edSectionWrapUp"), "rgba(255,255,255,.1)"),
        ab(40, 206, 580, 20, {
          borderRadius: 5,
          background: "repeating-linear-gradient(90deg, #eef0f3 0 34px, #c9ced6 34px 36px)",
        }),
        ab(x(0.7), 232, w(0.7, 2.3), 16, { borderRadius: 4, background: A }),
        ab(x(9.7), 232, w(9.7, 12.2), 16, { borderRadius: 4, background: A }),
        ab(40, 254, 580, 16, { borderRadius: 4, background: TH.card }),
        an(
          x(2.6),
          254,
          0,
          16,
          { borderRadius: 4, background: "#5a1532", border: `1px solid ${A}` },
          K(
            `${P}zb`,
            T,
            [
              [0, `width:${w(2.6, 4.3)}px`],
              [2.0, `width:${w(2.6, 5.6)}px`],
            ],
            { tr: 0.75 },
          ),
        ),
        ab(40, 276, 580, 16, { borderRadius: 4, background: TH.card }),
        an(
          x(6.6),
          276,
          w(6.6, 9.1),
          16,
          { borderRadius: 4, background: "rgba(88,166,255,.3)", border: "1px solid #58a6ff" },
          vis(`${P}pb`, T, 5.95, null, true),
        ),
        ab(40, 298, 580, 16, {
          borderRadius: 4,
          background:
            "repeating-linear-gradient(90deg, #5b8fb9 0 2px, transparent 2px 5px), linear-gradient(#0e0e10,#0e0e10)",
          opacity: 0.8,
        }),
        an(
          0,
          178,
          2,
          142,
          { background: "#fff", borderRadius: 1, boxShadow: "0 0 0 1px rgba(0,0,0,.4)" },
          K(
            `${P}ph`,
            T,
            [
              [0, "transform:translateX(40px)"],
              [T, "transform:translateX(620px)"],
            ],
            { tr: T, ease: "linear" },
          ),
        ),
        cursor(
          P,
          T,
          [
            [0, 330, 130],
            [1.0, x(4.3), 263],
            [2.0, x(5.6), 263],
            [5.85, x(7.8), 285],
            [8.6, 420, 120],
          ],
          [1.05, 5.9],
        ),
      )}
      beats={beats(P, T, [
        [t("edBeatSections"), 0.4],
        [t("edBeatZoom"), 2.6],
        [t("edBeatPrivate"), 6],
        [t("edBeatPoint"), 9.7],
      ])}
    />
  );
}
