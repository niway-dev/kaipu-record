---
title: Home copy review — English, Spanish, and Kai
description: Review-ready bilingual replacements, translation coverage gaps, FAQ copy, and a restrained introduction for Kai.
---

# Home copy review — English, Spanish, and Kai

**Proposed copy · 2026-09-30 · partially applied 2026-10-01.** The rows marked **applied** below landed in the catalogs with the [Kai plan](/plans/2026-10-01-home-kai-and-hero-copy/) before the web implementation branch. Compare the plan's Copy contract with `packages/i18n/messages/{en,es}.json` when in doubt. Everything else remains a proposal. Pair with the [audit](/marketing/home-conversion-audit/) and the [conversion umbrella](/plans/2026-10-01-home-conversion-v2/). Keep the current visual design; select wording by meaning, not by identical character counts.

## Catalog ground truth

At `1ade987`, `landing` contains **106 EN keys and 106 ES keys**, no missing counterparts and no empty strings. The first chat audit counted 96 before the origin strings were merged. Existing parity tests check keys and empty values, not hardcoded JSX, key collisions in raw JSON, translation quality, interactive locale behavior, or screenshot truthfulness.

Retain the current flat namespace for this iteration. Do not rename every numbered chapter or `Serif` key as part of conversion work. For additions, grep for an existing equivalent first. `landing.origin*` and `landing.footerSignature` already exist and must be reused. Keep existing brand names, file extensions, and identifiers intact rather than translating code tokens.

## Proposed changes to existing keys

All keys below are inside `landing`. Keep the original hero headline and closing invitation unless the creator selects a different variant.

| Key                                    | English proposal                                                                                                                        | Spanish proposal                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `homeHeroTitle`                        | Show it.                                                                                                                                | Muéstralo.                                                                                                                            |
| `homeHeroSerif` **(applied, ES only)** | Get back to work.                                                                                                                       | Sigue con lo tuyo.                                                                                                                    |
| `homeHeroBody` **(applied)**           | Record a bug. Explain a change. Annotate a screenshot. Turn what’s on your screen into something clear to share and easy to find again. | Graba un error. Explica un cambio. Anota una captura. Convierte lo que ves en algo claro para compartir y fácil de encontrar después. |
| `homeHeroPill3`                        | Quick edits                                                                                                                             | Edición rápida                                                                                                                        |
| `homeHeroPill4`                        | Your files, on your Mac                                                                                                                 | Tus archivos, en tu Mac                                                                                                               |
| `homeChapter1Serif`                    | Start with a shortcut.                                                                                                                  | Empieza con un atajo.                                                                                                                 |
| `homeChapter1Body`                     | Capture your screen, voice, and camera to show exactly what happened. Stop recording, then review the file in your library.             | Graba tu pantalla, voz y cámara para mostrar exactamente qué pasó. Al terminar, revisa el archivo en tu biblioteca.                   |
| `homeChapter1Pill1`                    | Menu bar                                                                                                                                | Barra de menús                                                                                                                        |
| `homeChapter2Body`                     | Capture the detail. Add an arrow or a note, hide sensitive information, and copy the result into your conversation.                     | Captura el detalle. Añade una flecha o una nota, oculta los datos sensibles y pega el resultado en tu conversación.                   |
| `homeChapter2Pill2`                    | Boxes & arrows                                                                                                                          | Recuadros y flechas                                                                                                                   |
| `homeChapter3Title`                    | Keep the point. Cut the rest.                                                                                                           | Deja lo importante. Recorta el resto.                                                                                                 |
| `homeChapter3Body`                     | Trim the extra, highlight the detail with zoom, and cover sensitive information. Export an MP4 while keeping your original.             | Recorta lo que sobra, destaca el detalle con zoom y cubre la información sensible. Exporta un MP4 y conserva el original.             |
| `homeChapter3Pill3`                    | Annotations                                                                                                                             | Anotaciones                                                                                                                           |
| `homeChapter4Body`                     | Find the walkthrough you already made. Search your recordings and screenshots by title, then open the one you need.                     | Encuentra lo que ya explicaste. Busca tus grabaciones y capturas por título y abre la que necesitas.                                  |
| `homeChapter4Pill4`                    | Reuse your captures                                                                                                                     | Reutiliza tus capturas                                                                                                                |
| `homeFilesBody`                        | Your recordings and screenshots are files in your local library folder. Open them in Finder and use them outside Kaipu.                 | Tus grabaciones y capturas son archivos en la carpeta de tu biblioteca local. Ábrelos en Finder y úsalos fuera de Kaipu.              |
| `homeFilesCheck2`                      | Recordings saved on your Mac                                                                                                            | Grabaciones guardadas en tu Mac                                                                                                       |
| `homeAppOn`                            | On                                                                                                                                      | Activado                                                                                                                              |
| `homeAppOff`                           | Off                                                                                                                                     | Desactivado                                                                                                                           |
| `homeHeroCtaMobile`                    | Copy download link                                                                                                                      | Copiar enlace de descarga                                                                                                             |
| `homeHeroMobileNote`                   | Kaipu runs on Mac. Copy the link and open it on your Mac when you're ready.                                                             | Kaipu funciona en Mac. Copia el enlace y ábrelo en tu Mac cuando quieras instalarlo.                                                  |
| `homeStickyCta`                        | Get Kaipu for Mac                                                                                                                       | Descarga Kaipu para Mac                                                                                                               |
| `homeHeroEyebrow` **(applied)**        | Screen recording & screenshots for Mac                                                                                                  | Grabación de pantalla y capturas para Mac                                                                                             |
| `homeHeroCtaPrimary` **(applied)**     | Download Kaipu for Mac                                                                                                                  | Descargar Kaipu para Mac                                                                                                              |
| `homeMomentsSub` **(applied)**         | Some things take three paragraphs to explain and ten seconds to show. Kaipu is for those moments.                                       | Hay cosas que toman tres párrafos explicar y diez segundos mostrar. Kaipu es para esos momentos.                                      |

**Behavior gates:** copy-link text requires a working clipboard action with failure fallback. The sticky CTA must agree with the chosen flow. Mac download labels require a correct architecture choice. Scope `On/Off` to the mockup controls and check Spanish wrapping. Shortcut glyphs come from the approved shared source, not translated prose. Once exported mute is implemented and validated, it may replace the annotations pill; do not restore boost.

Avoid changing `homeCtaFootnote` into another hardcoded compatibility promise. Separate the verified minimum-OS fact from a Windows roadmap link so the label matches the action. Keep “Your library is a folder,” the screenshot headline, and the Find headline: they already carry clear value.

## New copy slots to review

These key names are candidates, not additions already made. Reuse an existing semantic key where possible.

| Candidate key                  | English                                                                                                                                              | Spanish                                                                                                                                                                      | Condition                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `homeHeroCategory`             | Screen recording & screenshots for Mac                                                                                                               | Grabación y capturas de pantalla para Mac                                                                                                                                    | Applied as the value of the existing `homeHeroEyebrow` — no new key |
| `homeDownloadLinkCopied`       | Link copied. Open it on your Mac to download Kaipu.                                                                                                  | Enlace copiado. Ábrelo en tu Mac para descargar Kaipu.                                                                                                                       | Announce success only after the clipboard operation succeeds        |
| `homeDownloadLinkError`        | Couldn't copy the link. Select and copy it below.                                                                                                    | No se pudo copiar el enlace. Selecciónalo y cópialo abajo.                                                                                                                   | Expose a selectable URL as fallback                                 |
| `homeWindowsRoadmap`           | Follow Windows progress                                                                                                                              | Sigue el avance de Windows                                                                                                                                                   | Link to the existing roadmap; no email-notification promise         |
| `homeLocalTrust`               | Free local recording. No account needed.                                                                                                             | Grabación local gratis. Sin cuenta.                                                                                                                                          | Verify current distribution and local-use behavior                  |
| `homeNoWatermarkTrust`         | No watermark by default.                                                                                                                             | Sin marca de agua por defecto.                                                                                                                                               | Validated no-watermark release must be the actual download          |
| `homeKaiHeading` **(applied)** | Meet Kai.                                                                                                                                            | Conoce a Kai.                                                                                                                                                                | Third section of the home, after the moments band                   |
| `homeKaiBody` **(applied)**    | Kai is the fox behind Kaipu, the companion for moments worth capturing. You’ll see him in the menu bar when you choose recording or screenshot mode. | Kai es el zorro de Kaipu, el compañero de los momentos que vale la pena capturar. Lo verás en la barra de menús cuando elijas el modo de grabación o de captura de pantalla. | Names only what the app does today; no AI or reliability claim      |

Do not add a second signature key. Reuse `footerSignature` and the existing `origin*` messages. Keep the canonical formula and coined-name clarification whenever the origin is explained. A compact origin block can accompany Kai without turning the page into a brand essay.

## Four-question FAQ

| Question EN / ES                                            | Answer EN                                                                                                           | Answer ES                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| What can I do for free? / ¿Qué puedo hacer gratis?          | Record, annotate screenshots, edit, and export locally. The “Made with Kaipu” badge is optional and off by default. | Graba, anota capturas, edita y exporta en tu equipo. La marca «Hecho con Kaipu» es opcional y viene desactivada.      |
| Do I need an account? / ¿Necesito una cuenta?               | Not to record, edit, or export locally. An account is used for optional cloud capabilities.                         | No para grabar, editar ni exportar en tu equipo. La cuenta se usa para las funciones opcionales de la nube.           |
| Where are my files? / ¿Dónde están mis archivos?            | In your local library folder. Open it in Finder and use the files outside Kaipu.                                    | En la carpeta de tu biblioteca local. Ábrela en Finder y usa los archivos fuera de Kaipu.                             |
| Does it work on my computer? / ¿Funciona en mi computadora? | Kaipu is available for Mac with Apple Silicon and Intel downloads. Follow the roadmap for Windows progress.         | Kaipu está disponible para Mac con descargas para Apple Silicon e Intel. Consulta el avance de Windows en el roadmap. |

Publish the free/no-watermark answer only after checking the downloaded artifact. Add the actual supported minimum macOS version after release verification. Do not infer support from the current design text alone. Suggested family: `homeFaqFreeQuestion/Answer`, `homeFaqAccountQuestion/Answer`, `homeFaqFilesQuestion/Answer`, `homeFaqPlatformQuestion/Answer`.

## Visible translation coverage beyond the catalog

| Component                | Content to localize                                                                                  | Candidate family                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `mock-record.tsx`        | Checkout/payment illustration; Recording, Your voice, System audio, Camera, LIVE; camera description | `homeMockRecord*`                                           |
| `mock-capture.tsx`       | Team settings, Notifications, Owner, settings rows, note, Copy                                       | `homeMockCapture*`                                          |
| `mock-edit.tsx`          | Billing/API illustration, redaction text, actual available track labels, auto-zoom explanation       | `homeMockEdit*`                                             |
| `mock-find.tsx`          | Search, filters, titles, badges, dates/sizes, result count                                           | `homeMockFind*`                                             |
| `mock-finder.tsx`        | Sidebar folders, columns, file kinds, compatible-player explanation                                  | `homeMockFinder*`                                           |
| Navigation/illustrations | Theme label, open/close menu, locale names and active state, illustration summaries, skip link       | Existing settings keys where appropriate; otherwise `home*` |

User-interface labels belong in the selected language, including labels within drawn HTML scenes. Fictional filenames may remain stable identifiers. Use locale formatting for numbers/dates when data-driven, and ICU plural handling for variable result counts. Avoid piecing together English sentences from individually translated fragments. Keep deterministic SSR output.

## Semantic and continuity corrections

- Spanish “recorta las puntas” becomes “recorta el inicio y el final” wherever that precise operation is described.
- “Marca una captura” becomes “anota una captura”; boxes are “recuadros.”
- Do not translate state badges as user-created tags. Prefer the actual purpose or remove the weak marketing pill.
- Prefer “clave de API” in surrounding Spanish copy; do not translate an actual API identifier.
- Standardize one capture title across Record, Find, and Finder. Rename the bug title to include the demonstration's search term if necessary.
- The screenshot highlights deploy alerts: its library title should describe deploy alerts rather than mentions.
- Make the search result count match title-only search; do not imply transcript or visual search exists.
- **Applied:** the camera bubble shows Kai (`KaipuLogo use="product"`), decorative, with no text to localize.
- Keep `heroSubtitle` only if a live consumer still needs it. `footerTagline` and origin messages can still serve other routes; grep before deleting.

## SEO and measurement

The merged `seo.siteTitle` and `seo.siteDescription` already reflect recordings, screenshots, and local ownership. Retain them unless final copy requires a specific correction. Review the share preview as well as the page, but do not label this as an outstanding migration of the old SEO text.

After functional fixes, establish a baseline for download selections, architecture choice, copy-link success/failure, and any real demo play. Use existing analytics conventions and avoid putting capture names or recording content in events. Do not treat a download click as a completed installation or claim an uplift without evidence.
