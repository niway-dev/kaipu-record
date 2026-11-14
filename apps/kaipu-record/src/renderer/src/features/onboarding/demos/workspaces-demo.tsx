import type { ReactElement, ReactNode } from "react";
import { useDemoText } from "./demo-text";
import { A, DemoLayout, TH, ab, an, createScene, ctr, mk, mono, sp } from "./scene";
import { createTimeline } from "./timeline";

const T = 9.6;
const P = "w";
/** Second shown under reduced motion: the Work recording saved to its Drive folder. */
const FROZEN_AT = 7.5;

const WORK_BLUE = "#1f6fd1";
const CLIENT_TEAL = "#0f766e";

export function WorkspacesDemo({ reducedMotion }: { reducedMotion: boolean }): ReactElement {
  const t = useDemoText();
  const tl = createTimeline({ frozenAt: reducedMotion ? FROZEN_AT : undefined });
  const { K, vis, cursor, stage, beats } = createScene(tl);

  const pill = (tag: string, name: string, where: string, color: string): ReactNode[] => [
    sp(
      mono(9, "#fff", { fontWeight: 600, background: color, borderRadius: 4, padding: "3px 5px" }),
      tag,
    ),
    sp({ fontSize: 13, fontWeight: 600, color: TH.tx }, name),
    sp({ width: 1, height: 13, background: "rgba(255,255,255,.14)" }),
    sp({ fontSize: 12, color: TH.mut }, where),
  ];
  const pst = {
    borderRadius: 9,
    background: TH.card,
    border: "1px solid rgba(255,255,255,.16)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 11px",
  } as const;

  // [name, path, colour]. Provider names stay literal.
  const FOLD: ReadonlyArray<readonly [string, string, string]> = [
    [t("wsThisMac"), "~/Movies/Kaipu", "#3a3a42"],
    ["Google Drive", t("wsFolderWork"), WORK_BLUE],
    ["OneDrive", t("wsFolderClient"), CLIENT_TEAL],
  ];
  const WORKSPACES: ReadonlyArray<readonly [string, string, string, string]> = [
    ["PW", t("wsPersonal"), t("wsThisMac"), A],
    ["W", t("wsWork"), "Google Drive", WORK_BLUE],
    ["C", t("wsClient"), "OneDrive", CLIENT_TEAL],
  ];

  return (
    <DemoLayout
      id="workspaces"
      tl={tl}
      stage={stage(
        P,
        T,
        ab(36, 28, 250, 38, pst, ...pill("PW", t("wsPersonal"), t("wsThisMac"), A)),
        an(
          36,
          28,
          250,
          38,
          pst,
          vis(`${P}p2`, T, 3.6),
          ...pill("W", t("wsWork"), "Google Drive", WORK_BLUE),
        ),
        an(
          36,
          72,
          270,
          132,
          {
            borderRadius: 10,
            background: "#131316",
            border: "1px solid rgba(255,255,255,.16)",
            boxShadow: "0 20px 50px -18px rgba(0,0,0,.9)",
            transformOrigin: "20% 0%",
            zIndex: 3,
          },
          vis(`${P}dd`, T, 1.5, 3.6, true),
          an(
            6,
            46,
            258,
            38,
            { borderRadius: 7, background: "rgba(246,5,92,.16)" },
            vis(`${P}dh`, T, 2.85, 3.6),
          ),
          ...WORKSPACES.map(([tag, name, where, color], i) =>
            ab(
              14,
              8 + i * 40,
              244,
              34,
              { display: "flex", alignItems: "center", gap: 8 },
              ...pill(tag, name, where, color),
            ),
          ),
        ),
        ab(36, 226, 200, 14, mono(9, TH.faint, { letterSpacing: ".12em" }), t("wsNewRecording")),
        ...FOLD.map(([name, path, color], i) =>
          ab(
            350,
            28 + i * 94,
            274,
            78,
            { borderRadius: 10, background: TH.card, border: "1px solid rgba(255,255,255,.08)" },
            i === 1
              ? an(
                  -1,
                  -1,
                  274,
                  78,
                  {
                    borderRadius: 10,
                    border: `1.5px solid ${A}`,
                    background: "rgba(246,5,92,.08)",
                  },
                  vis(`${P}fh`, T, 6.1),
                )
              : null,
            ab(
              14,
              14,
              34,
              34,
              { borderRadius: 8, background: color, color: "#fff", ...ctr },
              mk("folder", 16),
            ),
            ab(60, 13, 200, 16, { fontSize: 13, fontWeight: 600, color: TH.tx }, name),
            ab(60, 32, 200, 14, mono(10, TH.mut), path),
            i === 0
              ? ab(
                  60,
                  52,
                  96,
                  18,
                  {
                    ...mono(9, TH.tx2, {
                      borderRadius: 4,
                      background: "#17171a",
                      border: "1px solid rgba(255,255,255,.1)",
                    }),
                    ...ctr,
                  },
                  "intro.mp4",
                )
              : null,
            i === 1
              ? an(
                  196,
                  10,
                  66,
                  18,
                  {
                    ...mono(8.5, A, {
                      letterSpacing: ".08em",
                      borderRadius: 4,
                      background: "rgba(246,5,92,.14)",
                    }),
                    ...ctr,
                  },
                  vis(`${P}sv`, T, 6.3, null, true),
                  t("wsSaved"),
                )
              : null,
          ),
        ),
        an(
          0,
          0,
          150,
          30,
          {
            borderRadius: 7,
            background: "#17171a",
            border: "1px solid rgba(255,255,255,.2)",
            gap: 7,
            color: TH.tx,
            boxShadow: "0 10px 24px -10px rgba(0,0,0,.9)",
            zIndex: 4,
            ...ctr,
          },
          K(
            `${P}fl`,
            T,
            [
              [0, "transform:translate(36px,246px);opacity:0"],
              [4.6, "transform:translate(36px,246px);opacity:1"],
              [6.0, "transform:translate(410px,168px) scale(.78);opacity:1"],
            ],
            { tr: 1.2 },
          ),
          mk("video", 13),
          sp(mono(10, TH.tx), "demo-11.56.mp4"),
        ),
        cursor(
          P,
          T,
          [
            [0, 200, 180],
            [1.3, 262, 48],
            [2.9, 160, 137],
            [4.5, 150, 290],
            [6.4, 300, 250],
          ],
          [1.35, 2.95],
        ),
      )}
      beats={beats(P, T, [
        [t("wsBeatPersonal"), 0.4],
        [t("wsBeatSwitch"), 3],
        [t("wsBeatSaved"), 6.1],
      ])}
    />
  );
}
