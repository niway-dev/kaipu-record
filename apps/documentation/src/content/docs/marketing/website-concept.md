---
title: Website concept — Kaipu in four moments
description: A product-led chapter experience, revised bilingual copy, and an asset production brief inspired by the owner's reference.
---

# Website concept — Kaipu in four moments

**2026-09-27 · Copy implemented; visual concept proposed.** The current landing structure is retained. New navigation, layout, illustrations, and media described below are not implemented.

**Brand alignment:** read [Brand identity](/marketing/brand-identity/) first. “This. Captured.” is the brand signature; “Show it. Get back to work.” remains the benefit-led hero. Kai's preferred direction is a living knot, with pixel art optional. Inspect the creator's new logo/notch artwork before generating more. Execution and validation live in the [rollout plan](/plans/2026-09-27-brand-and-website-rollout/).

## Creative direction

**An editorial product showcase with a small Kai signature.** Calm, spacious, precise, and warm. The memorable element is a large, real product scene that changes with each chapter; a slim floating chapter navigator makes the journey legible. Pixel art is an optional treatment after the knot silhouette is selected.

The owner supplied [pawan.app](https://pawan.app/) and a screenshot showing a large split composition, floating navigation, a vertical product selector, atmospheric color, and pixel-art characters. The screenshot is the visual reference; a text fetch did not expose enough of the live site to verify its interaction behavior. Borrow the hierarchy and sense of discovery, not its assets, characters, exact layout, or portfolio model. Kaipu is one product with several useful moments.

## Composition

- **Header:** Kaipu wordmark, Product, Your files, Roadmap, theme/language controls, Download. Add Source only once the repository is public.
- **Hero:** short headline at left, readable supporting copy, download CTA; at right, a large authentic recording/editor/library composition. Slight overlap creates depth without inventing app functionality.
- **Four chapters:** Record, Capture, Edit, Find. Each has a number, benefit-led heading, short explanation, and one large demonstration. Alternate compositions instead of repeating a uniform card grid.
- **Floating chapter rail:** a narrow, rounded vertical control at the right on wide screens, with numbers and recognizable icons. Active chapter and visible/accessible labels clarify its purpose. It is page navigation, not an app sidebar.
- **Ownership proof:** a full-width “Your library is a folder” scene showing a real MP4 in Finder.
- **Close:** factual trust details, a compact FAQ, and a second download invitation. No fake testimonials, counters, or unmeasured performance claims.

Use normal document scrolling and real anchor destinations. No scroll hijacking, forced full-screen slides, hidden sections, or timed carousel. On mobile, replace the rail with a compact wrapping chapter navigation; media and text stack in reading order. Honor reduced motion and provide visible focus/current-location treatment. Keep essential meaning in text, not only inside videos.

## Visual language

Keep existing pink and the light/dark token system. Dark uses deep neutral surfaces and restrained pink atmosphere around the product stage; light uses warm-looking neutral space and crisp frames, not a washed-out dark screenshot. Typography stays compatible with the existing Geist system: oversized headlines, comfortable body copy, small monospace chapter numbers. Pixel art belongs to Kai and a few signatures, not body text, every icon, or all borders.

One subtle reveal and a quiet active-chapter transition are enough. No custom cursor, roaming mascot, particle field, or animation that competes with the product recording. Explore marketing scale and composition without changing desktop UI tokens in this slice.

## Copy now in the application

Canonical localized strings are in `packages/i18n/messages/{en,es}.json`, under `landing` and the site-level `seo` fields. These excerpts show the narrative; edit the catalogs for runtime changes.

| Role            | English                                                                                                                                | Spanish                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Hero            | Show it. Get back to work.                                                                                                             | Muestra lo que pasa. Sigue con lo tuyo.                                                                                |
| Supporting copy | Record a bug. Walk through a change. Mark up a screenshot. Kaipu keeps your recordings and captures together, in a folder on your Mac. | Graba un error. Explica un cambio. Anota una captura. Kaipu reúne tus grabaciones y capturas en una carpeta de tu Mac. |
| Showcase        | From “look at this” to “got it.”                                                                                                       | De «mira esto» a «entendido».                                                                                          |
| Record          | Show what happened.                                                                                                                    | Muestra lo que pasó.                                                                                                   |
| Screenshot      | Sometimes, one screenshot says it all.                                                                                                 | A veces, una captura lo dice todo.                                                                                     |
| Edit            | A quick edit. A clearer point.                                                                                                         | Un pequeño ajuste. Una idea más clara.                                                                                 |
| Library         | Useful now. Easy to find later.                                                                                                        | Útil ahora. Fácil de encontrar después.                                                                                |
| Ownership       | Your library is a folder.                                                                                                              | Tu biblioteca es una carpeta.                                                                                          |
| Close           | Next time, show it with Kaipu.                                                                                                         | La próxima vez, muéstralo con Kaipu.                                                                                   |

## Brand origin section (implemented)

The landing carries the name's meaning between the Why cards and Download, at the `#origin`
anchor, rendered by `apps/web-hono/src/components/landing/brand-origin.tsx`. The footer repeats
the signature above the workflow line. [Brand identity](/marketing/brand-identity/) stays
canonical; this section is its public, condensed form.

| Placement | English                                                                                                    | Spanish                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Eyebrow   | Where the name comes from                                                                                  | De dónde viene el nombre                                                                                       |
| Signature | This. Captured.                                                                                            | Esto, registrado.                                                                                              |
| Formula   | KAY + khiPU                                                                                                | KAY + khiPU                                                                                                    |
| `kay`     | “This” — what is happening in front of you, and is worth showing.                                          | «Esto» — lo que está pasando frente a ti y vale la pena mostrar.                                               |
| `khipu`   | The Andean system of recording information with cords and knots.                                           | El sistema andino de registro de información con cuerdas y nudos.                                              |
| Body      | Kaipu brings both together: keeping what is happening, so you can explain it, share it, and find it again. | Kaipu une las dos ideas: conservar lo que está pasando para explicarlo, compartirlo y volver a encontrarlo.    |
| Note      | Kaipu is our own brand construction inspired by these two ideas, not a literal Quechua translation.        | Kaipu es una construcción de marca nuestra inspirada en esas dos ideas, no una traducción literal del quechua. |

The disclaimer ships with the section, not as a footnote to remove later: publishing the origin
without it would present a coined name as a translation. The section is text-only by design —
it must keep working before any Kai artwork exists, and Kai is added to it only after the
artwork is selected in phase B of the [rollout plan](/plans/2026-09-27-brand-and-website-rollout/).

The current card “You already explained this” supplies the Find chapter's future narrative. It is not yet a standalone demo section. Recording-quality presets already exist; this copy does not advertise the proposed destination-specific export presets.

## Additional copy for the visual implementation

| Placement             | English                                                                                                     | Spanish                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Eyebrow               | Screen recordings + screenshots                                                                             | Grabaciones + capturas de pantalla                                                                              |
| Secondary hero action | See it in action                                                                                            | Mira cómo funciona                                                                                              |
| Chapter rail          | Record · Capture · Edit · Find                                                                              | Graba · Captura · Edita · Encuentra                                                                             |
| Find body             | Find the walkthrough you made last week. Open the original, revisit your edits, or use the exported result. | Encuentra lo que explicaste la semana pasada. Abre el original, retoma la edición o usa el resultado exportado. |
| Ownership body        | Open the folder. There's your recording. A real file you can move, keep, and use outside Kaipu.             | Abre la carpeta. Ahí está tu grabación. Un archivo que puedes mover, guardar y usar fuera de Kaipu.             |
| Local-use FAQ         | Do I need an account? Not to record, edit, or export locally.                                               | ¿Necesito una cuenta? No para grabar, editar ni exportar en tu equipo.                                          |
| Files FAQ             | Where are my recordings? In your local library folder. Open them in Finder or another app.                  | ¿Dónde están mis grabaciones? En la carpeta de tu biblioteca local. Ábrelas en Finder o en otra app.            |

Only wire actions when their destination exists; “See it in action” should target the first demo, not a placeholder modal. Validate lineage/re-edit demonstrations in the packaged build before using the Find copy.

## Release-aware copy

| Claim              | Ready-to-use copy (EN / ES)                                                                                                                                       | Publish when                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Watermark          | Free. No watermark. Your files. / Gratis. Sin marca de agua. Tus archivos.                                                                                        | The no-watermark build is validated and the website download resolves to that release  |
| Optional badge FAQ | No watermark by default. You can turn on a “Made with Kaipu” badge in Settings. / Sin marca de agua por defecto. Puedes activar «Hecho con Kaipu» en Ajustes.     | Same release gate; older recordings may retain an already-baked mark                   |
| Windows CTA        | Download for Windows — beta / Descargar para Windows — beta                                                                                                       | Installer is available and beta limitations are documented beside it                   |
| Windows note       | Recording-only beta. Screenshot tools are currently available on Mac. / Beta solo de grabación. Las herramientas de captura de pantalla están disponibles en Mac. | Verify actual release scope before publication                                         |
| Source CTA         | Explore the source / Explora el código                                                                                                                            | The monorepo is public at a verified URL                                               |
| Trust detail       | Signed and notarized for macOS / Firmado y notarizado para macOS                                                                                                  | Verify the actual linked release; do not imply Windows signing or an Apple endorsement |

The current catalog keeps Windows as “coming soon” and omits watermark/open-source availability promises. This follows the [watermark release follow-up](/backlog/free-tier-no-watermark/), not a reversal of the owner's decision. Avoid “nothing uploaded”: local recordings and telemetry are different, and optional cloud capabilities exist.

## Media production brief

Create all clips from one fictional bug-report scenario, with invented account data. Keep UI text legible at its rendered size. Use actual Kaipu output; simulated interfaces cannot serve as feature evidence.

| Slot    | Storyboard                                                                          | Asset target                                                            |
| ------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Hero    | Trigger capture → reproduce a simple UI bug → trim → show the result in the library | 12–18 second montage; optional longer user-controlled walkthrough       |
| Record  | Real shortcut → source selection where required → record the bug → stop             | 8–12 second clip; do not hide required setup to imply it does not exist |
| Capture | Screenshot → crop → arrow/note → cover sample private data → PNG                    | 8–12 second clip plus a sharp final still                               |
| Edit    | Remove the false start → zoom to the issue → export → show original and result      | 10–15 seconds; label sped-up processing if used                         |
| Find    | Search for the same recording → open it → navigate source/export if validated       | 8–12 second clip                                                        |
| Folder  | Show in Finder → open the MP4 outside Kaipu                                         | 6–10 second proof clip                                                  |
| Kai     | Idle, attentive, holding a small capture frame                                      | Static transparent art first; restrained sprite animation later         |

Prefer muted MP4/WebM with matching posters for the website, not large autoplay GIFs. GIF is an optional derivative for compatible external destinations, not a requirement to redesign the site or evidence that Kaipu already exports GIF. Provide playback/pause control for sustained looping motion, stop offscreen media, and use static posters with reduced motion. Include captions/transcript for any narrated walkthrough. Record matching theme variants where useful; avoid doubling every download on page load.

## Production tools and sequence

1. **Copy and structure:** use the existing codebase and this brief. Claude and ChatGPT can both iterate on reasoning and frontend code; pick by actual results, tooling, and cost, not a blanket brand ranking.
2. **Art direction:** make static light/dark compositions with current screenshots. Confirm hierarchy before implementing the chapter rail.
3. **Mascot:** use an image-capable tool for concept exploration with the [Kai prompt](/marketing/brand-and-kai/#ready-to-use-image-prompt). Normalize the selected design on a real pixel grid before shipping.
4. **Product footage:** capture Kaipu itself, then edit it. An assistant can produce shot lists, scripts, and edit instructions; do not assume a Claude session has a video-generation tool. Generated UI footage is unsuitable as product proof.
5. **Implementation:** adapt the current landing components and demo slots; add the chapter navigation and new Find/Folder scenes incrementally. Evaluate mobile and both themes before polishing motion.

The best next investment is a convincing page composition using real screenshots, not a cinematic video or a complete rebrand. The page must explain Kaipu even if every video is paused.

## Review and validation

Ask a new visitor what Kaipu does, whether files stay usable outside the app, and which version they can download. Observe download discovery, chapter navigation, keyboard focus, small-screen heading wraps, and static-media comprehension. Check live destination artifacts before activating release-aware claims. Copy tests and a docs build cannot validate the proposed visual experience.
