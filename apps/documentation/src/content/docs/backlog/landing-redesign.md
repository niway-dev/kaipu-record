---
title: Landing redesign — feature showcase with looping demos
description: Rework the download landing so the product's features (record, screenshot, video editor, gallery) lead with looping muted video demos. Adds a reusable FeatureDemo component with a graceful poster fallback, and full es/en copy. Structure ships first; demo clips drop in later without code changes.
---

# Landing redesign — feature showcase with looping demos

> **Status: 🔵 Proposed.**
> Structure + copy + `FeatureDemo` component ship in one PR with poster
> placeholders. The owner records 8–12s clips afterwards; they drop into
> `public/demos/` and appear with no code change.

## Goal

The landing (`apps/web-hono/src/components/landing/`) sells a screen recorder
with static text and an empty hero box. For a product that is fundamentally
_visual and in-motion_, the strongest pitch is showing it work. Rework the page
so the core features lead with short looping demos, and the copy is
benefit-first.

## Why looping video, not GIF

The owner will record 8–12s clips. They publish as **muted looping `<video>`**,
not GIF:

- **Size:** a 10s screen clip is ~0.2–1 MB as MP4/WebM vs 5–20 MB as GIF.
- **Fidelity:** GIF's 256-color palette bands UI text and gradients; video is
  full-color and sharp.
- **Control:** `autoplay muted loop playsinline` + a `poster`, plus we can pause
  off-screen and honor reduced-motion.
- **On-brand:** the app itself exports MP4 — dogfooding.

AVIF/WebP-animated was considered as a middle ground but rejected: no play
control, fussier encoding, and no clear win over a `<video>` here.

## Page structure

Current order (`routes/index.tsx`): Nav → Hero → Features(4 cards) → Download →
Footer. New order:

```
Nav        brand · Download · theme toggle · language          (unchanged)
Hero       headline + subtitle + download CTA + LOOPING HERO VIDEO
Showcase   3 alternating rows, each a FeatureDemo (video + copy):
             🎥 Record      screen + floating camera
             📸 Screenshot  capture · arrows/boxes · blur
             ✂️ Editor      trim · annotate · slides · export MP4
WhyKaipu   compact card grid, no video:
             🗂️ Gallery · 🔒 Local-first & private · 🙅 No account
             🎚️ Configurable quality · ⌨️ Global shortcuts
Download    platforms · "free, macOS 11+, Windows soon"          (unchanged)
Footer                                                            (unchanged)
```

The existing `Features` component's four cards fold into **WhyKaipu** (their copy
is reused). Gallery becomes a card here (not a full row, per scope).

## Components

- **`FeatureDemo`** — the reusable showcase row. Props: `titleKey`, `bodyKey`,
  `demo` (base filename, e.g. `"record"`), `reverse` (alternate image/text
  side), optional `icon`. Renders copy on one side and the demo on the other.
- **`DemoVideo`** — the media element:

  ```tsx
  <video autoPlay muted loop playsInline poster={`/demos/${name}.jpg`}>
    <source src={`/demos/${name}.webm`} type="video/webm" />
    <source src={`/demos/${name}.mp4`} type="video/mp4" />
  </video>
  ```

  - **Graceful fallback:** when a clip is absent the `poster` (or a neutral
    framed placeholder with the app's border/card tokens) shows — so the page
    ships before any clip exists.
  - **Perf:** `preload="none"`; start playback only when scrolled into view
    (IntersectionObserver), pause when out of view.
  - **A11y:** under `prefers-reduced-motion`, do not autoplay — show the poster.
    Decorative, so `aria-hidden` with the copy carrying the meaning.

- **Hero** — replace the empty `aspect-video` placeholder with a `DemoVideo` for
  the flagship clip (`hero`).

Styling stays Tailwind + design tokens (`var(--kaipu-*)`), consistent with the
current components. No new deps.

## Copy (es / en)

All strings live in the `landing` namespace of
`packages/i18n/messages/{es,en}.json`. **Spanish is neutral — no voseo**
(`graba`, not `grabá`).

### Reused (unchanged)

`navBrand`, `navDownload`, `downloadTitle`, `downloadSubtitle`, `downloadMacArm`,
`downloadMacIntel`, `downloadWindows`, `footerTagline`.

### Hero (edited)

| key              | es                                                                                                          | en                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `heroTitleLine1` | Graba tu pantalla,                                                                                          | Record your screen,                                                                                               |
| `heroTitleLine2` | sin complicaciones.                                                                                         | without the hassle.                                                                                               |
| `heroSubtitle`   | Kaipu Record captura tu pantalla y cámara en alta calidad, directo en tu Mac. Privado, rápido y sin cuenta. | Kaipu Record captures your screen and camera in high quality, right on your Mac. Private, fast, and account-free. |

### Showcase section (new)

| key               | es                                                                                                                     | en                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `showcaseHeading` | Todo lo que necesitas para grabar y compartir                                                                          | Everything you need to record and share                                                                             |
| `showRecordTitle` | Graba lo que importa                                                                                                   | Record what matters                                                                                                 |
| `showRecordBody`  | Pantalla y cámara flotante en una sola toma, listo para tutoriales y demos. Empieza con un atajo, sin configurar nada. | Screen and floating camera in one take, ready for tutorials and demos. Start with a shortcut — no setup.            |
| `showShotTitle`   | Captura y explica                                                                                                      | Capture and explain                                                                                                 |
| `showShotBody`    | Toma una captura, recórtala, márcala con flechas y cajas, y oculta lo sensible con un blur. Todo en segundos.          | Take a screenshot, crop it, mark it up with arrows and boxes, and hide sensitive parts with a blur. All in seconds. |
| `showEditTitle`   | Edita sin salir de la app                                                                                              | Edit without leaving the app                                                                                        |
| `showEditBody`    | Corta lo que sobra, agrega notas y slides, y exporta un MP4 listo para compartir.                                      | Trim the extra, add notes and slides, and export a share-ready MP4.                                                 |

### Why Kaipu section (new heading + gallery/no-account cards; rest reused)

| key                     | es                                                                                             | en                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `whyHeading`            | Pensado para ir rápido y sin fricción                                                          | Built to be fast and frictionless                                                                |
| `featureGalleryTitle`   | Tu galería, siempre a mano                                                                     | Your gallery, always at hand                                                                     |
| `featureGalleryBody`    | Grabaciones y capturas organizadas en un solo lugar, con buscador y re-edición cuando quieras. | Recordings and screenshots organized in one place, with search and re-editing whenever you want. |
| `featureNoAccountTitle` | Sin cuenta                                                                                     | No account                                                                                       |
| `featureNoAccountBody`  | Sin registros ni logins. Descarga y graba.                                                     | No sign-ups, no logins. Download and record.                                                     |

Reused verbatim in the WhyKaipu grid: `featurePrivateTitle/Body`,
`featureQualityTitle/Body`, `featureShortcutsTitle/Body`. The now-unused
`featureScreenTitle/Body` (its content is covered by the Record showcase row) is
removed.

## Demo clip production guide (owner)

- **Clips:** `record`, `screenshot`, `editor`, plus optional `hero`.
- **Length:** 8–12s, composed to **loop cleanly** (end frame ≈ start frame).
- **Capture size:** ~2× the display box (≈1280–1600px wide), 30 fps.
- **Delivery:** drop source files; they get encoded to `.webm` + `.mp4` and a
  `.jpg` poster (first representative frame), output to
  `apps/web-hono/public/demos/` as `record.{webm,mp4,jpg}`, etc.
- Until a clip exists, its `FeatureDemo` shows the poster/placeholder — the page
  is shippable without any clip.

## Testing

- **Unit (web-hono)** — `FeatureDemo` renders the localized title/body and wires
  the `demo` name into the `<source>`/`poster` paths; `reverse` flips the layout
  side. `DemoVideo` falls back to the poster when sources are absent and does not
  autoplay under `prefers-reduced-motion` (mock `matchMedia`).
- **Manual/visual** — light + dark themes, mobile stacking of the alternating
  rows, and that the page reads well with placeholders (no clips yet).

## Rollout

One PR: new structure + `FeatureDemo`/`DemoVideo` + copy (es/en) + WhyKaipu
grid, all with poster placeholders. Demo clips land afterwards as plain asset
drops in `public/demos/` — no code change, no follow-up PR required.
