import type { ReactElement } from "react";
import { useDemoText } from "./demo-text";
import {
  A,
  DEMO_CURSOR_COLOR,
  DemoLayout,
  TH,
  ab,
  an,
  createScene,
  ctr,
  d,
  mk,
  mono,
  sp,
  win,
} from "./scene";
import { createTimeline } from "./timeline";

const T = 10;
const P = "s";
/** Second shown under reduced motion: YouTube picked, full-quality size on screen. */
const FROZEN_AT = 7.5;

export function ShareDemo({ reducedMotion }: { reducedMotion: boolean }): ReactElement {
  const t = useDemoText();
  const tl = createTimeline({ frozenAt: reducedMotion ? FROZEN_AT : undefined });
  const { K, vis, cursor, stage, beats } = createScene(tl);

  // [name, description, glyph background, glyph]. Brand names stay literal.
  const ROWS: ReadonlyArray<readonly [string, string, string, string]> = [
    ["GitHub · Jira · Linear", t("shareDestGithubDesc"), "#1b1b1f", "</>"],
    [t("shareDestChat"), t("shareDestChatDesc"), "#6b3fd4", "#"],
    ["YouTube", t("shareDestYoutubeDesc"), "#e5242b", "YT"],
    ["Reels · TikTok · Shorts", t("shareDestVerticalDesc"), "#d9208f", "9:16"],
  ];

  return (
    <DemoLayout
      id="share"
      tl={tl}
      stage={stage(
        P,
        T,
        ab(
          36,
          36,
          250,
          150,
          { borderRadius: 10, overflow: "hidden", background: "#17171a" },
          win(14, 14, 222, 150),
          ab(
            101,
            51,
            48,
            48,
            {
              borderRadius: "50%",
              background: "rgba(6,6,7,.75)",
              border: "1px solid rgba(255,255,255,.25)",
              color: "#fff",
              paddingLeft: 3,
              ...ctr,
            },
            mk("play", 20),
          ),
        ),
        ab(36, 194, 250, 16, mono(10.5, TH.mut), t("shareOriginalCaption")),
        ab(
          36,
          222,
          250,
          80,
          { borderRadius: 10, background: TH.card, border: "1px solid rgba(255,255,255,.1)" },
          an(
            14,
            14,
            222,
            40,
            { fontSize: 13, color: TH.mut, lineHeight: 1.4 },
            vis(`${P}l0`, T, 0, 1.8),
            t("shareQuestion"),
          ),
          an(
            14,
            10,
            222,
            44,
            null,
            vis(`${P}l1`, T, 2.0, 5.3),
            sp(mono(20, DEMO_CURSOR_COLOR, { fontWeight: 600 }), "~2 MB"),
            d({ fontSize: 11.5, color: TH.tx2, marginTop: 2 }, t("shareLightNote")),
          ),
          an(
            14,
            10,
            222,
            44,
            null,
            vis(`${P}l2`, T, 5.7),
            sp(mono(20, "#fff", { fontWeight: 600 }), "~48 MB"),
            d({ fontSize: 11.5, color: TH.tx2, marginTop: 2 }, t("shareFullNote")),
          ),
          ab(
            14,
            64,
            222,
            4,
            { borderRadius: 2, background: "#26262b", overflow: "hidden" },
            an(
              0,
              0,
              null,
              4,
              { background: A, borderRadius: 2 },
              K(
                `${P}bar`,
                T,
                [
                  [0, "width:0%"],
                  [2.0, "width:8%"],
                  [5.8, "width:94%"],
                ],
                { tr: 0.7 },
              ),
            ),
          ),
        ),
        ...ROWS.map(([name, desc, color, glyph], i) =>
          ab(
            330,
            36 + i * 66,
            294,
            56,
            { borderRadius: 10, background: TH.card, border: "1px solid rgba(255,255,255,.08)" },
            i === 0 || i === 2
              ? an(
                  -1,
                  -1,
                  294,
                  56,
                  { borderRadius: 10, border: `1.5px solid ${A}`, background: "rgba(246,5,92,.1)" },
                  i === 0 ? vis(`${P}h0`, T, 1.75, 5.3) : vis(`${P}h2`, T, 5.45),
                )
              : null,
            ab(
              12,
              12,
              32,
              32,
              {
                borderRadius: 8,
                background: color,
                color: "#fff",
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                fontWeight: 600,
                border: "1px solid rgba(255,255,255,.12)",
                ...ctr,
              },
              glyph,
            ),
            ab(
              54,
              11,
              220,
              16,
              { fontSize: 13, fontWeight: 600, color: TH.tx, whiteSpace: "nowrap" },
              name,
            ),
            ab(54, 30, 220, 14, { fontSize: 11.5, color: TH.mut, whiteSpace: "nowrap" }, desc),
          ),
        ),
        cursor(
          P,
          T,
          [
            [0, 300, 150],
            [1.6, 566, 66],
            [5.3, 566, 198],
            [8, 470, 300],
          ],
          [1.65, 5.35],
        ),
      )}
      beats={beats(P, T, [
        [t("shareBeatGithub"), 1.8],
        [t("shareBeatYoutube"), 5.5],
        [t("shareBeatOriginal"), 7.6],
      ])}
    />
  );
}
