---
title: Screenshot export formats (PNG now, PDF next)
description: Export-format roadmap for the screenshot editor — ships PNG, with PDF as the priority follow-up (infinite zoom / shareable page), plus JPG/WebP, SVG, and multi-format clipboard weighed. Proposes an exporter-per-format seam mirroring the ImageSource/reader pattern.
---

# Screenshot export formats (PNG now, PDF next)

> **Status: 🔵 Proposed.**

The screenshot editor (see [design spec](../specs/2026-06-29-screenshot-editor-design)) captures a
PNG, beautifies it (background / padding / corners / shadow), annotates it, and **exports**. Export
today is PNG only. This doc captures the format roadmap and a seam to grow it without churning the
editor.

## Now (v1) — PNG only

The editor composites the scene **once** to an offscreen canvas at the framed size (spec §4.5:
background → framed shot → annotations), then reuses that single bitmap for both **Copy** and
**Save** so the pixels are identical. Save writes `<id>.png` to the vault; the file is served back
through `kaipu-media://screenshot/<id>` and re-resolved via the `localReader`. PNG is the right v1
default: lossless, alpha (transparent "Ninguno" background), universally pasteable. Nothing below
changes this — it's the baseline every other format builds on.

## Future — PDF (priority)

The exciting one. A PDF lets a saved capture be a **shareable, zoomable page**: open it, zoom in as
far as you want, hand it to someone who has no Kaipu. Three Electron-friendly routes, in rough
order of fidelity vs effort:

- **`webContents.printToPDF`** — render the composed editor surface in an offscreen
  `BrowserWindow`/`webContents` and print to PDF. Zero new deps. But it paginates to paper sizes and
  the result is essentially a **rasterized snapshot** at the print DPI — the zoom benefit is capped
  by that DPI. Best when we want "good enough, no dependency".
- **`pdf-lib` (or `jsPDF`) embedding a high-DPI raster** — composite the canvas at 2–3× scale,
  embed that PNG into a single-page PDF sized to the image. Small, predictable dependency; we fully
  control page size and DPI, so **zoom is as deep as the embedded resolution**. The pragmatic pick.
- **True vector PDF** — emit the beautify frame + the annotation rough-paths as **vector** PDF
  content (the screenshot bitmap stays raster, but boxes/arrows/text render as crisp vectors at any
  zoom). Highest fidelity for annotations, infinite zoom on the markup; most work, because it needs
  a second renderer that maps the scene model → PDF drawing ops (the bitmap shot can't be vectorized).

**Tradeoffs.** Size: raster grows with DPI; vector is tiny except for the embedded shot. Fidelity:
`printToPDF` ≤ high-DPI raster < vector annotations. Dependency: `printToPDF` none, `pdf-lib` one
small lib, vector = `pdf-lib` + a scene→PDF mapper. **Key constraint:** the zoom selling point only
materializes with a **high-DPI raster** or **true vector** — a 1× `printToPDF` won't deliver it.
Recommended path: `pdf-lib` + high-DPI raster first; promote annotations to vector later if users
want sharper markup.

## Other candidates

- **JPG / WebP** — smaller, lossy, **no alpha**. Worth it for screenshots with a solid/gradient
  background where file size matters (sharing, upload). WebP gives better ratio than JPG at similar
  quality and `canvas.toBlob("image/webp")` is native in the Electron renderer. Add behind the same
  seam; expose a quality knob. Skip for transparent ("Ninguno") shots.
- **SVG** — tempting because the annotations are already SVG, but the screenshot itself is raster, so
  an SVG export is a vector wrapper around a base64-embedded bitmap — large and not meaningfully
  better than PDF for our case. **Low priority**; the vector-PDF route covers the same "crisp
  markup" want with a more shareable container.
- **Multi-format clipboard** — today Copy writes a PNG `nativeImage`. Offering richer clipboard
  payloads (e.g. PNG + a file reference, or PDF) is **niche**; most paste targets want the bitmap.
  Defer unless a concrete consumer asks.

## Where it fits — an exporter-per-format seam

The editor already composites once to a canvas. Mirror the `ImageSource`/reader pattern
([`image-source/`](../specs/2026-06-29-screenshot-editor-design)): the editor shouldn't know how
each format is encoded. Introduce an **exporter per format** keyed by a discriminator, so adding a
format is a new exporter + a union member, editor untouched — the dual of how adding an image origin
is a new reader.

```ts
type ExportFormat = "png" | "pdf" | "jpg" | "webp" /* | "svg" */;

interface ExportInput {
  canvas: HTMLCanvasElement; // the single composited frame (spec §4.5)
  scene: SceneDoc;           // for vector exporters that re-render annotations
  scale?: number;            // DPI multiplier for high-res raster / PDF
}

interface Exporter {
  format: ExportFormat;
  mimeType: string;
  extension: string;
  export(input: ExportInput): Promise<ArrayBuffer>;
}
```

- `pngExporter` / `jpgExporter` / `webpExporter` → `canvas.toBlob(mimeType, quality)`.
- `pdfExporter` → embed a high-DPI raster (or, later, walk `scene` to draw vectors).
- A small registry dispatches `export(format)` → the right exporter; Copy/Save/Download pick a
  format, the vault and `kaipu-media://` keep storing the bytes by `<id>.<extension>`.

## Recommendation & phasing

1. **PNG — now (built).** The lossless baseline; do not regress it.
2. **PDF — next (priority).** `pdf-lib` + high-DPI raster for real zoom; vector annotations as a
   later upgrade. This is the headline future format.
3. **JPG / WebP — on demand.** Cheap once the seam exists; add when file size / sharing pressure is real.
4. **SVG & multi-format clipboard — only if asked.** Low payoff for our raster-centric case.
