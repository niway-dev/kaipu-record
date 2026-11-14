import { createElement as E, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { SHARED_KEYFRAMES, type Timeline } from "./timeline";

/** Halo of the demo cursor. Mint, the complement of the brand pink; not a theme token. */
export const DEMO_CURSOR_COLOR = "#35F2C4";

/** The brand pink as a solid colour. Literal rgba(246,5,92,x) tints stay literal. */
export const A = "var(--accent-primary)";

/** Dark-theme palette of the demo stage (the demos always draw a dark recorder). */
export const TH = {
  card: "#0e0e10",
  sep: "rgba(255,255,255,.08)",
  strong: "rgba(255,255,255,.14)",
  tx: "#e8e8ed",
  tx2: "#c8c8d0",
  mut: "#a1a1aa",
  faint: "#62626a",
  good: "#22c55e",
} as const;

export const STAGE_WIDTH = 660;
export const STAGE_HEIGHT = 330;

type Style = CSSProperties;
type Kids = ReactNode[];

export const ctr: Style = { display: "flex", alignItems: "center", justifyContent: "center" };

export const mono = (size: number, color: string, extra?: Style): Style => ({
  fontFamily: "var(--font-mono)",
  fontSize: size,
  color,
  ...extra,
});

export const d = (style: Style, ...kids: Kids): ReactElement => E("div", { style }, ...kids);
export const sp = (style: Style, ...kids: Kids): ReactElement => E("span", { style }, ...kids);

/** An icon at a size and stroke width, as in the mock's `mk(I.name, size, sw)`. */
export const mk = (name: IconName, size: number, strokeWidth?: number): ReactElement =>
  E(Icon, { name, size, strokeWidth });

/** Absolutely positioned box at a pixel coordinate. */
export const ab = (
  x: number,
  y: number,
  w: number | null,
  h: number | null,
  style: Style | null,
  ...kids: Kids
): ReactElement =>
  E(
    "div",
    {
      style: {
        position: "absolute",
        left: x,
        top: y,
        width: w ?? undefined,
        height: h ?? undefined,
        boxSizing: "border-box",
        ...style,
      },
    },
    ...kids,
  );

/** `ab` with an animation shorthand. */
export const an = (
  x: number,
  y: number,
  w: number | null,
  h: number | null,
  style: Style | null,
  animation: string,
  ...kids: Kids
): ReactElement => ab(x, y, w, h, { animation, ...style }, ...kids);

/** A fake app window: title bar, dark sidebar, header, button and three rows. */
export const win = (x: number, y: number, w: number, h: number, ...kids: Kids): ReactElement =>
  ab(
    x,
    y,
    w,
    h,
    {
      borderRadius: 10,
      background: "#fff",
      overflow: "hidden",
      boxShadow: "0 20px 50px -24px rgba(0,0,0,.9)",
    },
    ab(
      0,
      0,
      w,
      22,
      { background: "#eef0f3", borderBottom: "1px solid #e2e5ea" },
      ...[0, 1, 2].map((i) =>
        ab(9 + i * 11, 8, 6, 6, { borderRadius: "50%", background: "#c9ced6" }),
      ),
    ),
    ab(
      0,
      22,
      w * 0.2,
      h - 22,
      { background: "#111827" },
      ...[0, 1, 2, 3].map((i) =>
        ab(10, 14 + i * 20, w * 0.2 - 26 - (i % 2) * 10, 6, {
          borderRadius: 3,
          background: i === 1 ? "#f9fafb" : "#374151",
        }),
      ),
    ),
    ab(w * 0.2 + 16, 36, 90, 10, { borderRadius: 3, background: "#111827" }),
    ab(w - 86, 32, 70, 20, { borderRadius: 5, background: A }),
    ...[0, 1, 2].map((i) =>
      ab(
        w * 0.2 + 16,
        66 + i * 34,
        w * 0.8 - 32,
        24,
        { borderRadius: 6, background: "#f6f7f9", border: "1px solid #e5e7eb" },
        ab(10, 8, 80 + i * 24, 6, { borderRadius: 3, background: "#cbd5e1" }),
      ),
    ),
    ...kids,
  );

/** Everything a demo needs, bound to one timeline. */
export function createScene(tl: Timeline) {
  const { K, vis, ringK } = tl;

  /** Cursor with a mint halo that follows `path` and pulses a ring at each click second. */
  const cursor = (
    p: string,
    T: number,
    path: ReadonlyArray<readonly [number, number, number]>,
    clicks: readonly number[],
  ): ReactElement =>
    E(
      "div",
      {
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          zIndex: 9,
          animation: K(
            `${p}cur`,
            T,
            path.map(([t, x, y]) => [t, `transform:translate(${x}px,${y}px)`] as const),
            { tr: 0.75 },
          ),
        },
      },
      ab(-17, -17, 34, 34, { borderRadius: "50%", background: DEMO_CURSOR_COLOR, opacity: 0.26 }),
      an(
        -17,
        -17,
        34,
        34,
        { borderRadius: "50%", border: `2.5px solid ${DEMO_CURSOR_COLOR}` },
        ringK(`${p}rg`, T, clicks),
      ),
      E(
        "svg",
        {
          width: 22,
          height: 22,
          viewBox: "0 0 24 24",
          style: {
            position: "absolute",
            left: -3,
            top: -2,
            transform: "rotate(-6deg)",
            filter: "drop-shadow(0 3px 5px rgba(0,0,0,.5))",
          },
        },
        E("path", {
          d: "M5 3l5.8 16.2 2.3-6.6 6.6-2.3z",
          fill: "#fff",
          stroke: "#0b0b0d",
          strokeWidth: 1.6,
          strokeLinejoin: "round",
        }),
      ),
    );

  /** Audio-level bars. They bounce, or hold a frame under reduced motion. */
  const bars = (n: number, color: string): ReactElement =>
    d(
      { display: "flex", alignItems: "center", gap: 2, height: 14 },
      ...Array.from({ length: n }, (_, i) =>
        sp({
          width: 2.5,
          height: 14,
          borderRadius: 2,
          background: color,
          transformOrigin: "50% 50%",
          animation: tl.loop("kbnc", 0.5 + (i % 4) * 0.13, "ease-in-out", i * 0.07, 0.1 + i * 0.07),
        }),
      ),
    );

  /** The 660 x 330 stage. Fades in and out each loop, or just stays put when frozen. */
  const stage = (p: string, T: number, ...kids: Kids): ReactElement =>
    E(
      "div",
      {
        "data-demo-stage": "",
        "aria-hidden": true,
        style: {
          position: "relative",
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          flexShrink: 0,
          borderRadius: 12,
          overflow: "hidden",
          background: "#0b0b0d",
          border: `1px solid ${TH.sep}`,
          fontFamily: "var(--font-family)",
          animation: tl.frozen
            ? undefined
            : K(`${p}st`, T, [
                [0, "opacity:0"],
                [0.4, "opacity:1"],
                [T, "opacity:0"],
              ]),
        },
      },
      ...kids,
    );

  /** The chip row under the stage; each chip lights up when its beat starts. */
  const beats = (
    p: string,
    T: number,
    list: ReadonlyArray<readonly [string, number]>,
  ): ReactElement =>
    d(
      {
        display: "flex",
        gap: 7,
        flexWrap: "wrap",
        justifyContent: "center",
        marginTop: 12,
      },
      ...list.map(([label, t], i) =>
        E(
          "span",
          {
            key: i,
            "data-demo-beat": "",
            style: {
              ...mono(10, TH.tx, {
                letterSpacing: ".06em",
                padding: "5px 9px",
                borderRadius: 999,
                border: `1px solid ${TH.strong}`,
                background: TH.card,
                whiteSpace: "nowrap",
              }),
              animation: K(
                `${p}b${i}`,
                T,
                [
                  [0, "opacity:.32"],
                  [Math.max(0.36, t), "opacity:1"],
                ],
                { tr: 0.3 },
              ),
            },
          },
          label,
        ),
      ),
    );

  return { K, vis, ringK, cursor, bars, stage, beats };
}

export type Scene = ReturnType<typeof createScene>;

/** Stage + chips in the mock's 700 px column, with the one `<style>` the timeline produced. */
export function DemoLayout({
  id,
  tl,
  stage,
  beats,
}: {
  id: string;
  tl: Timeline;
  stage: ReactNode;
  beats: ReactNode;
}): ReactElement {
  return (
    <div
      data-demo={id}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 700 }}
    >
      <style>{`${SHARED_KEYFRAMES}\n${tl.css()}`}</style>
      {stage}
      {beats}
    </div>
  );
}
