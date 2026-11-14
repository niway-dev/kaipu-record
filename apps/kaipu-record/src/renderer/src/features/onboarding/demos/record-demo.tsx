import type { ReactElement } from "react";
import { useDemoText } from "./demo-text";
import type { IconName } from "./icons";
import {
  A,
  DemoLayout,
  TH,
  ab,
  an,
  createScene,
  ctr,
  DEMO_CURSOR_COLOR,
  mk,
  mono,
  sp,
  win,
} from "./scene";
import { createTimeline } from "./timeline";

const T = 10;
const P = "r";
/** Second shown under reduced motion: recording, all three sources on. */
const FROZEN_AT = 7.5;

export function RecordDemo({ reducedMotion }: { reducedMotion: boolean }): ReactElement {
  const t = useDemoText();
  const tl = createTimeline({ frozenAt: reducedMotion ? FROZEN_AT : undefined });
  const { vis, cursor, bars, stage, beats } = createScene(tl);

  const tog = (x: number, ic: IconName, at: number) =>
    ab(
      x,
      6,
      32,
      32,
      null,
      ab(
        0,
        0,
        32,
        32,
        { borderRadius: 8, background: "#17171a", color: TH.mut, ...ctr },
        mk(ic, 16),
      ),
      an(
        0,
        0,
        32,
        32,
        { borderRadius: 8, background: A, color: "#fff", ...ctr },
        vis(`${P}t${x}`, T, at),
        mk(ic, 16),
      ),
    );

  const pillBox = {
    borderRadius: 7,
    background: "rgba(11,11,13,.92)",
    border: "1px solid rgba(255,255,255,.2)",
    gap: 7,
    ...ctr,
  };

  return (
    <DemoLayout
      id="record"
      tl={tl}
      stage={stage(
        P,
        T,
        win(90, 22, 480, 226),
        an(
          88,
          20,
          484,
          230,
          { borderRadius: 12, border: `2px solid ${A}`, boxShadow: "0 0 0 5px rgba(246,5,92,.22)" },
          vis(`${P}rr`, T, 6.5),
        ),
        an(
          104,
          52,
          92,
          24,
          { borderRadius: 6, background: "rgba(11,11,13,.9)", gap: 6, ...ctr },
          vis(`${P}rb`, T, 6.5, null, true),
          sp({
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: A,
            animation: tl.loop("kblink", 1, "ease-in-out", 0),
          }),
          sp(mono(10.5, "#fff", { letterSpacing: ".08em" }), "REC 0:03"),
        ),
        an(
          196,
          210,
          74,
          28,
          pillBox,
          vis(`${P}mm`, T, 1.7, null, true),
          sp(mono(8.5, TH.mut, { letterSpacing: ".1em" }), t("recMic")),
          bars(6, DEMO_CURSOR_COLOR),
        ),
        an(
          276,
          210,
          118,
          28,
          pillBox,
          vis(`${P}sa`, T, 3.3, null, true),
          sp(mono(8.5, TH.mut, { letterSpacing: ".1em" }), t("recSystem")),
          bars(9, "#fff"),
        ),
        an(
          482,
          160,
          74,
          74,
          {
            borderRadius: "50%",
            border: "2.5px solid #fff",
            background:
              "radial-gradient(circle at 50% 38%, #e8c4b0 0 23%, #6b4a3a 24% 25%, #23232b 62%)",
            boxShadow: "0 12px 30px -10px rgba(0,0,0,.8)",
            overflow: "hidden",
          },
          vis(`${P}cb`, T, 4.9, null, true),
          ab(19, 44, 36, 40, { borderRadius: "40% 40% 0 0", background: "#33333d" }),
        ),
        ab(
          180,
          270,
          300,
          44,
          {
            borderRadius: 12,
            background: TH.card,
            border: "1px solid rgba(255,255,255,.16)",
            boxShadow: "0 16px 40px -14px rgba(0,0,0,.9)",
          },
          ab(
            8,
            8,
            72,
            28,
            {
              borderRadius: 7,
              background: "#17171a",
              gap: 6,
              color: TH.tx2,
              fontSize: 11.5,
              fontWeight: 600,
              ...ctr,
            },
            mk("monitor", 13),
            t("frame"),
          ),
          tog(92, "mic", 1.6),
          tog(130, "speaker", 3.2),
          tog(168, "webcam", 4.8),
          ab(208, 10, 1, 24, { background: "rgba(255,255,255,.12)" }),
          ab(
            216,
            7,
            76,
            30,
            {
              borderRadius: 8,
              background: A,
              color: "#fff",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              ...ctr,
            },
            sp({ width: 8, height: 8, borderRadius: "50%", background: "#fff" }),
            t("record"),
          ),
          an(
            216,
            7,
            76,
            30,
            {
              borderRadius: 8,
              background: "#26262b",
              color: "#fff",
              gap: 6,
              border: `1px solid ${A}`,
              ...ctr,
            },
            vis(`${P}rs`, T, 6.4),
            sp({ width: 8, height: 8, borderRadius: 2, background: A }),
            sp(mono(11.5, "#fff"), "0:03"),
          ),
        ),
        cursor(
          P,
          T,
          [
            [0, 340, 140],
            [1.5, 288, 292],
            [3.1, 326, 292],
            [4.7, 364, 292],
            [6.3, 434, 292],
            [8.2, 500, 120],
          ],
          [1.55, 3.15, 4.75, 6.35],
        ),
      )}
      beats={beats(P, T, [
        [t("recBeatMic"), 1.6],
        [t("recBeatSystem"), 3.2],
        [t("recBeatCamera"), 4.8],
        [t("recBeatRecording"), 6.4],
      ])}
    />
  );
}
