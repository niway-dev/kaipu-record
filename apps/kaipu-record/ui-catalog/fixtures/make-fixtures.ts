import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Generates the neutral media the UI catalog's vault is built from (spec "Fixtures"): one
 * countdown video every recording is cut from, a webcam-sized variant, a GIF, a thumbnail,
 * and four grey "application window" drawings for screenshots. Nothing here comes from a
 * real screen, so nothing personal can reach an image.
 *
 * Everything is drawn with `color`/`drawbox`/`overlay` only. The digits are seven-segment
 * boxes rather than `drawtext`, because Homebrew's ffmpeg on the runner is built without
 * libfreetype, and a font would make the output depend on what the machine has installed.
 *
 * Output: `ui-catalog/fixtures/out/` (git-ignored). Regenerated when the recipe version in
 * `out/.version` differs, so a change here reaches the runner without a manual clean.
 */

export const FIXTURES_DIR = path.join(__dirname, "out");

/** Bump when anything below changes the generated files. */
const RECIPE_VERSION = "4";

/** Seconds of the countdown; every recording fixture is a cut of it. */
export const COUNTDOWN_SECONDS = 12;
/** The cuts the seed uses, in seconds; one file each, so a cut is never made at seed time. */
export const RECORDING_CUTS = [12, 9, 7, 5, 4, 3] as const;
export type RecordingCut = (typeof RECORDING_CUTS)[number];

export const FIXTURE_FILES = {
  countdown: "countdown.mp4",
  webcam: "countdown-webcam.mp4",
  gif: "countdown.gif",
  thumbnail: "countdown-thumb.jpg",
  screens: ["screen-a.png", "screen-b.png", "screen-c.png", "screen-d.png"],
  /** A small interface drawing with exact, known colors (the Colors panel states). */
  colorsShot: "colors-shot.png",
  /** Smooth gradients plus noise, thousands of exact colors: counts as a photograph. */
  photoShot: "photo-shot.png",
  cut: (seconds: RecordingCut) => `countdown-${seconds}s.mp4`,
  /**
   * The recording a seeded edit joins ("Checkout bug"): the same countdown on a blue ground with a
   * "B" in the corner, cut to `JOINED_CUT_SECONDS`, so its filmstrip is told apart from the
   * opened recording's. Same size, codec and container as `cut`.
   */
  joinedCut: "countdown-joined-7s.mp4",
  /**
   * The joined variant at 1080x1080 (1:1) for the recording that joined a square one: the same
   * blue ground and "B", cut to `JOINED_CUT_SECONDS`. Its aspect differs from the opened 16:9
   * recording's, so the preview fits it inside the frame with the background around it.
   */
  joinedSquareCut: "countdown-joined-square-7s.mp4",
} as const;

/** Length of `FIXTURE_FILES.joinedCut`; it is also the seed's duration for that recording. */
export const JOINED_CUT_SECONDS = 7;

const JOINED_BACKGROUND = "0x1d4ed8";

const BACKGROUND = "0x1c1d21";
const DIGIT = "0xe4e5e9";
const PROGRESS = "0x5b8def";

// Flags that keep encoder versions and timestamps out of the bytes where ffmpeg allows it.
const BITEXACT = ["-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact"];
const NO_METADATA = ["-map_metadata", "-1", "-metadata", "creation_time=1970-01-01T00:00:00Z"];

/** Seven-segment layout: which segments each digit lights. */
const DIGIT_SEGMENTS: Record<number, string> = {
  0: "abcdef",
  1: "bc",
  2: "abdeg",
  3: "abcdg",
  4: "bcfg",
  5: "acdfg",
  6: "acdefg",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The boxes of one segment for a digit drawn at (x, y), `w` wide, `h` tall, `t` thick. */
function segmentBox(segment: string, x: number, y: number, w: number, h: number, t: number): Box {
  const half = (h - 3 * t) / 2;
  switch (segment) {
    case "a":
      return { x: x + t, y, w: w - 2 * t, h: t };
    case "b":
      return { x: x + w - t, y: y + t, w: t, h: half };
    case "c":
      return { x: x + w - t, y: y + 2 * t + half, w: t, h: half };
    case "d":
      return { x: x + t, y: y + h - t, w: w - 2 * t, h: t };
    case "e":
      return { x, y: y + 2 * t + half, w: t, h: half };
    case "f":
      return { x, y: y + t, w: t, h: half };
    default:
      return { x: x + t, y: y + t + half, w: w - 2 * t, h: t };
  }
}

/** The number shown during second `s` of the countdown: 10, 9, … 0, and 0 to the end. */
export function countdownValue(second: number): number {
  return Math.max(0, 10 - second);
}

/**
 * `drawbox` filters that draw the countdown on a `width`×`height` frame: one box per
 * (digit position, segment), enabled during the seconds it is lit.
 */
export function countdownDigitFilters(width: number, height: number): string[] {
  const digitH = Math.round(height * 0.41);
  const digitW = Math.round(digitH * 0.55);
  const thick = Math.max(2, Math.round(digitH * 0.11));
  const gap = Math.round(digitW * 0.33);
  const top = Math.round((height - digitH) / 2);
  const single = Math.round((width - digitW) / 2);
  const pairLeft = Math.round((width - (2 * digitW + gap)) / 2);
  const positions = { single, tens: pairLeft, ones: pairLeft + digitW + gap } as const;

  const lit = new Map<string, { box: Box; seconds: number[] }>();
  for (let second = 0; second < COUNTDOWN_SECONDS; second++) {
    const value = countdownValue(second);
    const digits: Array<[keyof typeof positions, number]> =
      value >= 10
        ? [
            ["tens", Math.floor(value / 10)],
            ["ones", value % 10],
          ]
        : [["single", value]];
    for (const [position, digit] of digits) {
      for (const segment of DIGIT_SEGMENTS[digit]) {
        const key = `${position}:${segment}`;
        const entry = lit.get(key) ?? {
          box: segmentBox(segment, positions[position], top, digitW, digitH, thick),
          seconds: [],
        };
        entry.seconds.push(second);
        lit.set(key, entry);
      }
    }
  }
  return [...lit.values()].map(({ box, seconds }) => {
    const enable = seconds.map((s) => `between(t\\,${s}\\,${s + 0.999})`).join("+");
    return `drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=${DIGIT}:t=fill:enable='${enable}'`;
  });
}

/**
 * A block "B" in the top-left corner: a full left column, three bars (top, middle, bottom) that
 * stop one stroke short of the right edge, and two right columns with a gap between them.
 */
export function joinedLetterFilters(width: number, height: number): string[] {
  const h = Math.round(height * 0.3);
  const w = Math.round(h * 0.6);
  const t = Math.max(2, Math.round(h * 0.14));
  const x = Math.round(width * 0.06);
  const y = Math.round(height * 0.08);
  const half = (h - 3 * t) / 2;
  const boxes: Box[] = [
    { x, y, w: t, h }, // left column
    { x, y, w: w - t, h: t }, // top bar
    { x, y: y + t + half, w: w - t, h: t }, // middle bar
    { x, y: y + h - t, w: w - t, h: t }, // bottom bar
    { x: x + w - t, y: y + t, w: t, h: half }, // right column, upper
    { x: x + w - t, y: y + 2 * t + half, w: t, h: half }, // right column, lower
  ];
  return boxes.map((b) => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${DIGIT}:t=fill`);
}

/** The full filtergraph of a countdown frame, `width`×`height`, with its progress line. */
export function countdownFilterGraph(
  width: number,
  height: number,
  variant: "default" | "joined" = "default",
): string {
  const line = Math.max(2, Math.round(height / 180));
  const background = variant === "joined" ? JOINED_BACKGROUND : BACKGROUND;
  const extra = variant === "joined" ? `,${joinedLetterFilters(width, height).join(",")}` : "";
  return [
    `color=c=${background}:s=${width}x${height}:r=30:d=${COUNTDOWN_SECONDS}[bg]`,
    `color=c=${PROGRESS}:s=${width}x${line}:r=30:d=${COUNTDOWN_SECONDS}[bar]`,
    `[bg][bar]overlay=x='-W+W*t/${COUNTDOWN_SECONDS}':y=H-${line * 4}:eval=frame:shortest=1,` +
      `${countdownDigitFilters(width, height).join(",")}${extra}[v]`,
  ].join(";");
}

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

/** H.264 + silent stereo AAC, one keyframe per second so every cut lands on a keyframe. */
function renderCountdown(
  out: string,
  width: number,
  height: number,
  variant: "default" | "joined" = "default",
): void {
  ffmpeg([
    "-filter_complex",
    countdownFilterGraph(width, height, variant),
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=48000:cl=stereo`,
    "-map",
    "[v]",
    "-map",
    "0:a",
    "-t",
    String(COUNTDOWN_SECONDS),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-movflags",
    "+faststart",
    ...BITEXACT,
    ...NO_METADATA,
    out,
  ]);
}

/**
 * A grey "application window" at 2880×1800: a title bar, a sidebar and content blocks,
 * laid out differently per variant so the four screenshots are told apart. No text.
 */
export function windowDrawingFilters(variant: number): string {
  const W = 2880;
  const H = 1800;
  const boxes: Array<[number, number, number, number, string]> = [
    [120, 120, W - 240, H - 240, "0x2b2d33"], // window
    [120, 120, W - 240, 96, "0x34363d"], // title bar
    [168, 152, 32, 32, "0x5a5d66"], // three chrome dots
    [224, 152, 32, 32, "0x5a5d66"],
    [280, 152, 32, 32, "0x5a5d66"],
  ];
  const sidebar = variant % 2 === 0;
  const left = sidebar ? 640 : 200;
  if (sidebar) {
    boxes.push([120, 216, 480, H - 336, "0x26282d"]);
    for (let i = 0; i < 7; i++) boxes.push([168, 280 + i * 96, 384, 48, "0x3a3d45"]);
  }
  const columns = 2 + (variant % 3);
  const gap = 48;
  const width = Math.floor((W - 120 - left - 80 - gap * (columns - 1)) / columns);
  boxes.push([left, 280, W - 120 - left - 80, 120, "0x3f424b"]); // header block
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < columns; col++) {
      const shade = ["0x353840", "0x3b3e47", "0x30333a"][(row + col + variant) % 3];
      boxes.push([left + col * (width + gap), 460 + row * 380, width, 320, shade]);
    }
  }
  return boxes
    .map(([x, y, w, h, c]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${c}:t=fill`)
    .join(",");
}

/**
 * `drawbox` filters for the Colors panel's interface drawing (640x400). Every color is exact
 * on purpose: two near-identical pairs (#ffffff page and #fdfdfd card, #f6055c and #f4055a
 * buttons) show the panel's group boxes, and a divider splits the card into two areas of the
 * same color. Drawn in planar RGB (`gbrp`) so no yuv conversion moves a value by one.
 */
export function colorsShotFilters(): string {
  const boxes: Array<[number, number, number, number, string]> = [
    [0, 0, 140, 400, "0xf3f4f6"], // sidebar
    ...[0, 1, 2, 3, 4].map((i): [number, number, number, number, string] => [
      20,
      40 + i * 36,
      90,
      8,
      "0x9ca3af",
    ]), // sidebar items
    [168, 38, 434, 254, "0xe5e7eb"], // card border
    [170, 40, 430, 250, "0xfdfdfd"], // card
    [170, 210, 430, 2, "0xe5e7eb"], // divider: the card is two areas of one color
    [194, 64, 180, 14, "0x111827"], // heading
    [194, 92, 120, 10, "0x1f2937"], // subheading
    [194, 124, 380, 6, "0x6b7280"], // paragraph
    [194, 140, 340, 6, "0x6b7280"],
    [194, 156, 360, 6, "0x6b7280"],
    [194, 232, 110, 32, "0xf6055c"], // primary button
    [320, 232, 110, 32, "0xf4055a"], // the same button, one step off
    [170, 320, 200, 6, "0x6b7280"], // footer text on the page
  ];
  return [
    "format=gbrp",
    ...boxes.map(([x, y, w, h, c]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${c}:t=fill`),
  ].join(",");
}

/**
 * The photograph stand-in: three smooth waves, one per channel, with seeded noise, so the
 * file is the same on every machine and has far more than 1,000 exact colors. The waves
 * stay inside 0-255 (a negative would wrap to a bright spot).
 */
export const PHOTO_SHOT_FILTERS =
  "format=gbrp," +
  "geq=r='128+100*sin(X/90)*cos(Y/70)':g='110+90*sin((X+Y)/110)':b='100+90*cos(X/120)*sin(Y/60)'," +
  "noise=alls=14:allf=t+u:all_seed=7";

/** True when every fixture exists and was made by this recipe. */
export function fixturesReady(dir: string = FIXTURES_DIR): boolean {
  const stamp = path.join(dir, ".version");
  if (!existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== RECIPE_VERSION) return false;
  return [
    FIXTURE_FILES.countdown,
    FIXTURE_FILES.webcam,
    FIXTURE_FILES.gif,
    FIXTURE_FILES.thumbnail,
    FIXTURE_FILES.joinedCut,
    FIXTURE_FILES.joinedSquareCut,
    ...FIXTURE_FILES.screens,
    FIXTURE_FILES.colorsShot,
    FIXTURE_FILES.photoShot,
    ...RECORDING_CUTS.map(FIXTURE_FILES.cut),
  ].every((name) => existsSync(path.join(dir, name)));
}

/** Generate every fixture into `dir`, replacing what is there. Needs `ffmpeg` on PATH. */
export function makeFixtures(dir: string = FIXTURES_DIR): void {
  const work = `${dir}.tmp`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const at = (name: string): string => path.join(work, name);

  renderCountdown(at(FIXTURE_FILES.countdown), 1920, 1080);
  for (const seconds of RECORDING_CUTS) {
    ffmpeg([
      "-i",
      at(FIXTURE_FILES.countdown),
      "-t",
      String(seconds),
      "-c",
      "copy",
      ...BITEXACT,
      ...NO_METADATA,
      at(FIXTURE_FILES.cut(seconds)),
    ]);
  }
  // The joined recording: rendered on its own (a blue ground, a "B"), then cut like the others.
  renderCountdown(at("countdown-joined.mp4"), 1920, 1080, "joined");
  ffmpeg([
    "-i",
    at("countdown-joined.mp4"),
    "-t",
    String(JOINED_CUT_SECONDS),
    "-c",
    "copy",
    ...BITEXACT,
    ...NO_METADATA,
    at(FIXTURE_FILES.joinedCut),
  ]);
  rmSync(at("countdown-joined.mp4"));
  renderCountdown(at("countdown-joined-square.mp4"), 1080, 1080, "joined");
  ffmpeg([
    "-i",
    at("countdown-joined-square.mp4"),
    "-t",
    String(JOINED_CUT_SECONDS),
    "-c",
    "copy",
    ...BITEXACT,
    ...NO_METADATA,
    at(FIXTURE_FILES.joinedSquareCut),
  ]);
  rmSync(at("countdown-joined-square.mp4"));
  renderCountdown(at(FIXTURE_FILES.webcam), 640, 480);
  // The first second shows "10": the frame a recording's poster is taken from.
  ffmpeg([
    "-ss",
    "0.5",
    "-i",
    at(FIXTURE_FILES.countdown),
    "-frames:v",
    "1",
    "-vf",
    "scale=640:360",
    "-q:v",
    "3",
    ...BITEXACT,
    at(FIXTURE_FILES.thumbnail),
  ]);
  ffmpeg([
    "-i",
    at(FIXTURE_FILES.countdown),
    "-t",
    "4",
    "-filter_complex",
    "fps=10,scale=480:270:flags=neighbor,split[a][b];[a]palettegen=max_colors=16[p];[b][p]paletteuse=dither=none",
    "-loop",
    "0",
    ...BITEXACT,
    at(FIXTURE_FILES.gif),
  ]);
  FIXTURE_FILES.screens.forEach((name, variant) => {
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `color=c=0x1a1b1f:s=2880x1800:d=1`,
      "-vf",
      windowDrawingFilters(variant),
      "-frames:v",
      "1",
      ...BITEXACT,
      at(name),
    ]);
  });
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0xffffff:s=640x400:d=1",
    "-vf",
    colorsShotFilters(),
    "-frames:v",
    "1",
    ...BITEXACT,
    at(FIXTURE_FILES.colorsShot),
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=640x400:d=1",
    "-vf",
    PHOTO_SHOT_FILTERS,
    "-frames:v",
    "1",
    ...BITEXACT,
    at(FIXTURE_FILES.photoShot),
  ]);
  writeFileSync(path.join(work, ".version"), `${RECIPE_VERSION}\n`);

  rmSync(dir, { recursive: true, force: true });
  renameSync(work, dir);
}

/** Generate the fixtures unless the current recipe's are already there. */
export function ensureFixtures(dir: string = FIXTURES_DIR): void {
  if (fixturesReady(dir)) return;
  console.log(`[ui-catalog] generating fixtures in ${path.relative(process.cwd(), dir)}`);
  makeFixtures(dir);
}

if (require.main === module) {
  makeFixtures();
  console.log(`[ui-catalog] fixtures written to ${FIXTURES_DIR}`);
}
