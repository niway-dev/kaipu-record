import type { ReactElement } from "react";
import { useDemoText } from "./demo-text";
import type { IconName } from "./icons";
import { A, DemoLayout, TH, ab, an, createScene, ctr, mk, mono, sp, win } from "./scene";
import { createTimeline } from "./timeline";

const T = 12.6;
const P = "c";
/** Second shown under reduced motion: the annotated image, copied. */
const FROZEN_AT = 11.5;

const tx = (i: number): number => 14 + i * 30;

export function CaptureDemo({ reducedMotion }: { reducedMotion: boolean }): ReactElement {
  const t = useDemoText();
  const tl = createTimeline({ frozenAt: reducedMotion ? FROZEN_AT : undefined });
  const { K, vis, cursor, stage, beats } = createScene(tl);

  const tool = (i: number, ic: IconName, a?: number, b?: number) =>
    ab(
      tx(i),
      5,
      26,
      26,
      null,
      ab(0, 0, 26, 26, { color: "#8a8a92", ...ctr }, mk(ic, 15)),
      a
        ? an(
            0,
            0,
            26,
            26,
            { borderRadius: 6, background: A, color: "#fff", ...ctr },
            vis(`${P}tl${i}`, T, a, b),
            mk(ic, 15),
          )
        : null,
    );

  const rowStyle = { borderRadius: 6, background: "#f6f7f9", border: "1px solid #e5e7eb" };

  return (
    <DemoLayout
      id="capture"
      tl={tl}
      stage={stage(
        P,
        T,
        an(
          0,
          0,
          660,
          330,
          null,
          K(`${P}A`, T, [
            [0, "opacity:1"],
            [4.5, "opacity:0"],
          ]),
          win(70, 26, 520, 250),
          an(
            150,
            60,
            0,
            0,
            {
              border: `1.5px solid ${A}`,
              background: "rgba(246,5,92,.1)",
              boxShadow: "0 0 0 1px rgba(255,255,255,.8)",
            },
            K(
              `${P}sel`,
              T,
              [
                [0, "width:0px;height:0px;opacity:0"],
                [0.9, "width:0px;height:0px;opacity:1"],
                [2.2, "width:320px;height:160px;opacity:1"],
              ],
              { tr: 1.2 },
            ),
          ),
          an(
            150,
            226,
            78,
            20,
            { borderRadius: 5, background: "rgba(11,11,13,.92)", ...ctr },
            vis(`${P}sz`, T, 2.3),
            sp(mono(10, "#fff"), "640 × 320"),
          ),
          an(
            0,
            0,
            660,
            330,
            { background: "#fff" },
            K(
              `${P}fl`,
              T,
              [
                [0, "opacity:0"],
                [2.55, "opacity:.75"],
                [2.95, "opacity:0"],
              ],
              { tr: 0.1 },
            ),
          ),
          an(
            424,
            252,
            222,
            62,
            {
              borderRadius: 10,
              background: TH.card,
              border: "1px solid rgba(255,255,255,.16)",
              boxShadow: "0 16px 40px -14px rgba(0,0,0,.9)",
            },
            vis(`${P}to`, T, 3.1, null, true),
            ab(
              8,
              8,
              62,
              46,
              { borderRadius: 5, background: "#fff", overflow: "hidden" },
              ab(0, 0, 14, 46, { background: "#111827" }),
              ab(40, 6, 16, 6, { borderRadius: 2, background: A }),
            ),
            ab(
              78,
              13,
              96,
              16,
              { fontSize: 11.5, fontWeight: 600, color: TH.tx, whiteSpace: "nowrap" },
              t("copied"),
            ),
            ab(78, 31, 96, 14, mono(9, TH.mut), "640 × 320 · PNG"),
            ab(
              180,
              16,
              30,
              30,
              { borderRadius: 8, background: "rgba(246,5,92,.16)", color: A, ...ctr },
              mk("pen", 15),
            ),
          ),
        ),
        an(
          0,
          0,
          660,
          330,
          { background: "#060607" },
          K(`${P}B`, T, [
            [0, "opacity:0"],
            [4.5, "opacity:1"],
          ]),
          ab(
            0,
            0,
            660,
            36,
            { borderBottom: "1px solid rgba(255,255,255,.08)", background: "#060607" },
            tool(0, "select"),
            tool(1, "pen"),
            tool(2, "box", 5.3, 6.9),
            tool(3, "arrow"),
            tool(4, "text", 9.1, 10.5),
            tool(5, "step", 6.95, 7.6),
            ab(tx(6) + 4, 9, 1, 18, { background: "rgba(255,255,255,.12)" }),
            tool(6.5, "ruler", 7.7, 9.05),
            ab(
              560,
              6,
              86,
              24,
              {
                borderRadius: 6,
                background: A,
                color: "#fff",
                fontSize: 11.5,
                fontWeight: 600,
                gap: 5,
                ...ctr,
              },
              t("capCopy"),
            ),
          ),
          ab(
            150,
            64,
            360,
            200,
            { borderRadius: 6, background: "#fff", overflow: "hidden" },
            ab(0, 0, 60, 200, { background: "#111827" }),
            ab(78, 22, 90, 10, { borderRadius: 3, background: "#111827" }),
            ab(250, 24, 90, 26, { borderRadius: 5, background: A }),
            ...[0, 1, 2].map((i) => ab(78, 70 + i * 40, 262, 28, rowStyle)),
          ),
          an(
            394,
            82,
            0,
            38,
            { border: `2.5px solid ${A}`, borderRadius: 9 },
            K(
              `${P}bx`,
              T,
              [
                [0, "width:0px;opacity:0"],
                [5.75, "width:0px;opacity:1"],
                [6.5, "width:102px;opacity:1"],
              ],
              { tr: 0.7 },
            ),
          ),
          an(
            380,
            70,
            24,
            24,
            {
              borderRadius: "50%",
              background: A,
              color: "#fff",
              boxShadow: "0 0 0 2px #fff, 0 4px 10px rgba(0,0,0,.5)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 600,
              ...ctr,
            },
            vis(`${P}bd`, T, 7.2, null, true),
            "1",
          ),
          an(
            229,
            218,
            0,
            2,
            { background: A, boxShadow: "0 0 0 1px rgba(255,255,255,.9)" },
            K(
              `${P}rl`,
              T,
              [
                [0, "width:0px;opacity:0"],
                [7.95, "width:0px;opacity:1"],
                [8.6, "width:260px;opacity:1"],
              ],
              { tr: 0.6 },
            ),
          ),
          an(
            322,
            190,
            62,
            20,
            {
              borderRadius: 5,
              background: "rgba(11,11,13,.94)",
              border: "1px solid rgba(255,255,255,.24)",
              ...ctr,
            },
            vis(`${P}rlb`, T, 8.7, null, true),
            sp(mono(11, "#fff"), "520 px"),
          ),
          an(
            232,
            96,
            0,
            24,
            {
              overflow: "hidden",
              whiteSpace: "nowrap",
              color: A,
              fontWeight: 700,
              fontSize: 16,
              lineHeight: "24px",
            },
            K(
              `${P}tp`,
              T,
              [
                [0, "width:0px"],
                [9.3, "width:0px"],
                [10.3, "width:110px"],
              ],
              { tr: 1, ease: "steps(12,end)" },
            ),
            t("capAnnotation"),
          ),
          an(
            140,
            54,
            380,
            220,
            { border: "1px dashed rgba(255,255,255,.5)", borderRadius: 2 },
            vis(`${P}ef`, T, 10.7),
          ),
          an(
            280,
            286,
            100,
            28,
            {
              borderRadius: 8,
              background: TH.card,
              border: "1px solid rgba(255,255,255,.16)",
              gap: 6,
              color: TH.tx,
              fontSize: 12,
              ...ctr,
            },
            vis(`${P}cp`, T, 11.2, null, true),
            sp({ display: "flex", color: TH.good }, mk("check", 13, 2.4)),
            t("copied"),
          ),
        ),
        cursor(
          P,
          T,
          [
            [0, 150, 60],
            [0.9, 150, 60],
            [2.2, 470, 220],
            [3.9, 619, 283],
            [5.2, tx(2) + 13, 18],
            [5.75, 394, 84],
            [6.5, 496, 120],
            [6.9, tx(5) + 13, 18],
            [7.2, 392, 82],
            [7.65, tx(6.5) + 13, 18],
            [7.95, 229, 219],
            [8.6, 489, 219],
            [9.05, tx(4) + 13, 18],
            [9.3, 232, 108],
            [10.3, 342, 108],
            [11.1, 603, 18],
          ],
          [0.95, 4.0, 5.25, 6.95, 7.25, 7.7, 9.1, 11.15],
        ),
      )}
      beats={beats(P, T, [
        [t("capBeatSelect"), 0.9],
        [t("capBeatEditor"), 4.2],
        [t("capBeatBox"), 5.8],
        [t("capBeatSteps"), 7.2],
        [t("capBeatMeasure"), 8],
        [t("capBeatText"), 9.4],
        [t("capBeatCopy"), 11.1],
      ])}
    />
  );
}
