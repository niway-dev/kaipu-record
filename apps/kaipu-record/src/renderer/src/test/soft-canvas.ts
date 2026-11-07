/**
 * A software Canvas2D for tests that must look at PIXELS (jsdom has no canvas and the repo
 * ships no native one). It implements only what the export composer and the layers it draws
 * use: solid and linear-gradient fills, rects, rounded rects, arcs, clips, translate/scale,
 * `drawImage` between SoftCanvases and `ImageData` reads, plus canvas-style drop shadows
 * (the shape's alpha, offset, blurred, drawn under the shape and inside the clip).
 *
 * Deliberately simple: pixel-centre coverage (no anti-aliasing), nearest-neighbour
 * sampling and a box-blur shadow. It checks WHERE the composer puts things and in WHAT
 * ORDER — that is, its logic — not Skia's rendering. Install it as the global
 * `OffscreenCanvas` with `vi.stubGlobal("OffscreenCanvas", SoftCanvas)`.
 */

export type Rgba = [number, number, number, number];

type Paint = string | SoftGradient;

class SoftGradient {
  private readonly stops: Array<{ at: number; color: Rgba }> = [];
  constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly x1: number,
    private readonly y1: number,
  ) {}
  addColorStop(at: number, color: string): void {
    this.stops.push({ at, color: parseColor(color) });
    this.stops.sort((a, b) => a.at - b.at);
  }
  colorAt(x: number, y: number): Rgba {
    const dx = this.x1 - this.x0;
    const dy = this.y1 - this.y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : ((x - this.x0) * dx + (y - this.y0) * dy) / len2;
    const first = this.stops[0];
    const last = this.stops[this.stops.length - 1];
    if (!first || !last) return [0, 0, 0, 0];
    if (t <= first.at) return first.color;
    if (t >= last.at) return last.color;
    for (let i = 1; i < this.stops.length; i++) {
      const a = this.stops[i - 1]!;
      const b = this.stops[i]!;
      if (t <= b.at) {
        const k = (t - a.at) / (b.at - a.at || 1);
        return a.color.map((v, c) => v + (b.color[c]! - v) * k) as Rgba;
      }
    }
    return last.color;
  }
}

/** `#rgb`, `#rrggbb`, `rgb()` and `rgba()` → [r, g, b, a(0–255)]. */
export function parseColor(input: string): Rgba {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex =
      s.length === 4
        ? s
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")
        : s.length === 9
          ? s.slice(1, 7)
          : s.slice(1);
    const alpha = s.length === 9 ? parseInt(s.slice(7, 9), 16) : 255;
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      alpha,
    ];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1]!.split(",").map((p) => parseFloat(p));
    return [parts[0]!, parts[1]!, parts[2]!, Math.round((parts[3] ?? 1) * 255)];
  }
  throw new Error(`soft-canvas: unsupported colour ${input}`);
}

type Point = { x: number; y: number };
type Polygon = Point[];
type Clip = (x: number, y: number) => boolean;

interface State {
  fillStyle: Paint;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  clips: Clip[];
}

function pointInPolygons(polygons: Polygon[], x: number, y: number): boolean {
  let inside = false;
  for (const poly of polygons) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export class SoftCanvas {
  readonly data: Uint8ClampedArray;
  private ctx: SoftContext | null = null;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  getContext(): SoftContext {
    this.ctx ??= new SoftContext(this);
    return this.ctx;
  }
  /** [r, g, b, a] at a pixel. */
  pixel(x: number, y: number): Rgba {
    const i = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }
}

export class SoftContext {
  fillStyle: Paint = "#000000";
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  filter = "none";
  font = "";
  textAlign = "start";
  textBaseline = "alphabetic";
  private tx = 0;
  private ty = 0;
  private sx = 1;
  private sy = 1;
  private clips: Clip[] = [];
  private path: Polygon[] = [];
  private stack: State[] = [];

  constructor(private readonly canvas: SoftCanvas) {}

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY,
      tx: this.tx,
      ty: this.ty,
      sx: this.sx,
      sy: this.sy,
      clips: this.clips,
    });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    Object.assign(this, s);
  }
  translate(x: number, y: number): void {
    this.tx += x * this.sx;
    this.ty += y * this.sy;
  }
  scale(x: number, y: number): void {
    this.sx *= x;
    this.sy *= y;
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SoftGradient {
    return new SoftGradient(x0, y0, x1, y1);
  }

  // ── paths ────────────────────────────────────────────────────────────────
  private toDevice(x: number, y: number): Point {
    return { x: this.tx + x * this.sx, y: this.ty + y * this.sy };
  }
  beginPath(): void {
    this.path = [];
  }
  private current(): Polygon {
    return (this.path[this.path.length - 1] ??= []);
  }
  moveTo(x: number, y: number): void {
    this.path.push([this.toDevice(x, y)]);
  }
  lineTo(x: number, y: number): void {
    this.current().push(this.toDevice(x, y));
  }
  closePath(): void {
    /* polygons are closed implicitly */
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.push([
      this.toDevice(x, y),
      this.toDevice(x + w, y),
      this.toDevice(x + w, y + h),
      this.toDevice(x, y + h),
    ]);
  }
  roundRect(x: number, y: number, w: number, h: number, radii: number): void {
    const r = Math.max(0, Math.min(radii, w / 2, h / 2));
    const poly: Polygon = [];
    const corner = (cx: number, cy: number, from: number): void => {
      for (let i = 0; i <= 12; i++) {
        const a = from + (i / 12) * (Math.PI / 2);
        poly.push(this.toDevice(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
      }
    };
    corner(x + w - r, y + r, -Math.PI / 2);
    corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI / 2);
    corner(x + r, y + r, Math.PI);
    this.path.push(poly);
  }
  arc(x: number, y: number, r: number, start: number, end: number): void {
    const poly: Polygon = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const a = start + ((end - start) * i) / steps;
      poly.push(this.toDevice(x + Math.cos(a) * r, y + Math.sin(a) * r));
    }
    this.path.push(poly);
  }
  /** The tangent arc of the Canvas spec; a straight corner when the radius is 0. */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    const poly = this.current();
    const last = poly[poly.length - 1];
    if (!last) return;
    const p0 = { x: (last.x - this.tx) / this.sx, y: (last.y - this.ty) / this.sy };
    const l1 = Math.hypot(p0.x - x1, p0.y - y1);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    if (r <= 0 || l1 === 0 || l2 === 0) {
      poly.push(this.toDevice(x1, y1));
      return;
    }
    const u1 = { x: (p0.x - x1) / l1, y: (p0.y - y1) / l1 };
    const u2 = { x: (x2 - x1) / l2, y: (y2 - y1) / l2 };
    const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    if (Math.sin(theta) < 1e-6) {
      poly.push(this.toDevice(x1, y1));
      return;
    }
    const dist = r / Math.tan(theta / 2);
    const t1 = { x: x1 + u1.x * dist, y: y1 + u1.y * dist };
    const t2 = { x: x1 + u2.x * dist, y: y1 + u2.y * dist };
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
    const bl = Math.hypot(bis.x, bis.y);
    const toCentre = r / Math.sin(theta / 2);
    const c = { x: x1 + (bis.x / bl) * toCentre, y: y1 + (bis.y / bl) * toCentre };
    const a0 = Math.atan2(t1.y - c.y, t1.x - c.x);
    let sweep = Math.atan2(t2.y - c.y, t2.x - c.x) - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    poly.push(this.toDevice(t1.x, t1.y));
    for (let i = 1; i <= 12; i++) {
      const t = a0 + (sweep * i) / 12;
      poly.push(this.toDevice(c.x + Math.cos(t) * r, c.y + Math.sin(t) * r));
    }
  }
  clip(): void {
    const polygons = this.path.map((p) => [...p]);
    this.clips = [...this.clips, (x, y) => pointInPolygons(polygons, x, y)];
  }

  // ── painting ──────────────────────────────────────────────────────────────
  private inClip(x: number, y: number): boolean {
    return this.clips.every((c) => c(x, y));
  }
  private blend(px: number, py: number, color: Rgba, coverage = 1): void {
    const { width, height, data } = this.canvas;
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const a = (color[3] / 255) * coverage;
    if (a <= 0) return;
    const i = (py * width + px) * 4;
    const da = data[i + 3]! / 255;
    const oa = a + da * (1 - a);
    for (let c = 0; c < 3; c++) {
      data[i + c] = (color[c]! * a + data[i + c]! * da * (1 - a)) / (oa || 1);
    }
    data[i + 3] = oa * 255;
  }
  private paintAt(x: number, y: number): Rgba {
    return typeof this.fillStyle === "string"
      ? parseColor(this.fillStyle)
      : this.fillStyle.colorAt(x, y);
  }
  private hasShadow(): boolean {
    return (
      parseColor(this.shadowColor)[3] > 0 &&
      (this.shadowBlur > 0 || this.shadowOffsetX !== 0 || this.shadowOffsetY !== 0)
    );
  }
  /** The shadow of a shape given as a coverage test in device space, under the clip. */
  private paintShadow(covers: (x: number, y: number) => number): void {
    const { width, height } = this.canvas;
    const shadow = parseColor(this.shadowColor);
    const offX = this.shadowOffsetX;
    const offY = this.shadowOffsetY;
    let mask: Float32Array = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) mask[y * width + x] = covers(x + 0.5 - offX, y + 0.5 - offY);
    }
    // σ = blur / 2 (canvas); three box passes approximate the Gaussian.
    const sigma = this.shadowBlur / 2;
    const radius = Math.max(0, Math.round((sigma * Math.sqrt(12 / 3 + 1) - 1) / 2));
    if (radius > 0)
      for (let pass = 0; pass < 3; pass++) mask = boxBlur(mask, width, height, radius);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (this.inClip(x + 0.5, y + 0.5)) this.blend(x, y, shadow, mask[y * width + x]!);
      }
    }
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const a = this.toDevice(x, y);
    const b = this.toDevice(x + w, y + h);
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const covers = (px: number, py: number): number =>
      px >= x0 && px < x1 && py >= y0 && py < y1 ? 1 : 0;
    if (this.hasShadow()) this.paintShadow(covers);
    for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
      for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
        if (covers(px + 0.5, py + 0.5) && this.inClip(px + 0.5, py + 0.5)) {
          this.blend(px, py, this.paintAt(px + 0.5, py + 0.5));
        }
      }
    }
  }
  fill(): void {
    const polygons = this.path.map((p) => [...p]);
    const covers = (px: number, py: number): number => (pointInPolygons(polygons, px, py) ? 1 : 0);
    if (this.hasShadow()) this.paintShadow(covers);
    for (let py = 0; py < this.canvas.height; py++) {
      for (let px = 0; px < this.canvas.width; px++) {
        if (covers(px + 0.5, py + 0.5) && this.inClip(px + 0.5, py + 0.5)) {
          this.blend(px, py, this.paintAt(px + 0.5, py + 0.5));
        }
      }
    }
  }
  fillText(): void {
    /* labels are not pixel-tested */
  }
  drawImage(image: SoftCanvas, ...args: number[]): void {
    let [sx, sy, sw, sh, dx, dy, dw, dh] = [
      0,
      0,
      image.width,
      image.height,
      0,
      0,
      image.width,
      image.height,
    ];
    if (args.length === 2) [dx, dy] = args as [number, number];
    else if (args.length === 4) [dx, dy, dw, dh] = args as [number, number, number, number];
    else
      [sx, sy, sw, sh, dx, dy, dw, dh] = args as number[] as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    const a = this.toDevice(dx!, dy!);
    const b = this.toDevice(dx! + dw!, dy! + dh!);
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const flipX = b.x < a.x;
    const sample = (px: number, py: number): Rgba | null => {
      if (px < x0 || px >= x1 || py < y0 || py >= y1) return null;
      const u = (px - x0) / (x1 - x0);
      const v = (py - y0) / (y1 - y0);
      const ix = Math.min(
        image.width - 1,
        Math.max(0, Math.floor(sx! + (flipX ? 1 - u : u) * sw!)),
      );
      const iy = Math.min(image.height - 1, Math.max(0, Math.floor(sy! + v * sh!)));
      return image.pixel(ix, iy);
    };
    if (this.hasShadow()) {
      this.paintShadow((px, py) => (sample(px, py)?.[3] ?? 0) / 255);
    }
    for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
      for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
        if (!this.inClip(px + 0.5, py + 0.5)) continue;
        const color = sample(px + 0.5, py + 0.5);
        if (color) this.blend(px, py, color);
      }
    }
  }
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) out.set(this.canvas.pixel(x + i, y + j), (j * w + i) * 4);
    }
    return { data: out };
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const size = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / size;
      sum += src[y * w + Math.min(w - 1, x + r + 1)]! - src[y * w + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/** A SoftCanvas of one flat colour: a stand-in for a decoded frame. */
export function solidCanvas(width: number, height: number, color: string): SoftCanvas {
  const canvas = new SoftCanvas(width, height);
  const ctx = canvas.getContext();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}
