---
title: Kaipu brand identity
description: The canonical meaning of Kaipu, its Peruvian inspiration, voice, product promise, and relationship to Kai.
---

# Kaipu brand identity

**Canonical brand decision · adopted by the creator on 2026-09-27.** Consult this page before changing brand copy, the logo, mascot, onboarding, or marketing. The meaning is settled. The visual identity is settled too, since 2026-10-01: Kai is the fox shipped in `packages/brand` (see [Visual identity and Kai](#visual-identity-and-kai)).

## The definition we preserve

**Kaipu = KAY + khiPU → «Esto, registrado».**

This is our creative brand construction, not a literal Quechua translation, a historically attested word derivation, or an exact orthographic concatenation.

- **KAY** contributes the idea of “this”: what is happening and worth capturing, in the creator's adopted interpretation.
- **khiPU** refers to the khipu/quipu, the Andean system of recording information through cords and knots.
- **Kaipu** brings pointing at a moment and keeping a record together.
- **Kai** is the affectionate short form and the mascot's name. Its meaning within the brand derives from Kaipu, not from a separately verified Quechua word.

The creator adopted this explanation explicitly on 2026-09-27. The original naming conversation was not recovered; do not describe this as a rediscovered historical transcript.

## Brand signature and product messaging

| Role            | Spanish                                 | English                                   |
| --------------- | --------------------------------------- | ----------------------------------------- |
| Brand signature | **Esto, registrado.**                   | **This. Captured.**                       |
| Landing promise | Muestra lo que pasa. Sigue con lo tuyo. | Show it. Get back to work.                |
| Workflow        | Captura. Explica. Vuelve a encontrarlo. | Capture it. Make it clear. Find it again. |

“This. Captured.” is the chosen advertising adaptation, not a literal translation. Avoid “This registered.” The signature explains the identity; the landing promise explains the immediate benefit. They can coexist without becoming competing taglines.

## Reusable origin story

> Kaipu brings together an inspiration in “kay” — this — and the khipu, the Andean system of recording information with cords and knots. For us, it means “This. Captured.”: keeping what is happening so we can explain it, share it, and find it again. Kai is the companion that brings that idea to life.

Approved Spanish brand copy:

> Kaipu une una inspiración en «kay» —esto— con el khipu, el sistema andino de registro mediante cuerdas y nudos. Para nosotros significa «esto, registrado»: capturar lo que está pasando y conservarlo para explicarlo, compartirlo y volver a encontrarlo. Kai es el compañero que representa esa idea.

## Where this identity is published

**Home status (2026-10-01):** the four-moments home carries the identity in its third section, "Meet Kai" (`apps/web-hono/src/components/home/kai.tsx`), which reuses the `landing.origin*` messages and shows the signature "This. Captured." in place. The unmounted `BrandOrigin` component is retired from the home. The home-specific footer does not render `footerSignature`, but `components/landing/footer.tsx` still uses that key on routes mounted through `PublicShell`. Nothing else changed in the adopted meaning. Shipped in [PR #202](https://github.com/niway-dev/kaipu-record/pull/202).

The meaning no longer depends on a chat transcript or a file outside the repository. It is
carried in three places, each with a different job:

| Surface                               | Carries                                                                    | File                                                              |
| ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| This page                             | The canonical decision, sources, voice, and change rule                    | `apps/documentation/src/content/docs/marketing/brand-identity.md` |
| Root README, “Why Kaipu”              | The short form a new contributor meets first                               | `README.md`                                                       |
| Home "Meet Kai" section (EN/ES)       | The public origin story and coined-name qualification beside the character | `apps/web-hono/src/components/home/kai.tsx`                       |
| Public-shell footer signature (EN/ES) | The compact brand signature on other public routes                         | `apps/web-hono/src/components/landing/footer.tsx`                 |

Landing wording lives in `packages/i18n/messages/{en,es}.json` under `landing.origin*`,
`landing.homeKai*`, and `landing.footerSignature`; an EN/ES parity test fails if one catalog drifts. Changing the meaning
means changing this page first, then those three surfaces together — never one of them alone.

## Purpose and product fit

Kaipu helps people turn what they see into a clear, reusable explanation. Its initial audience is people building software who capture bugs, changes, feedback, and walkthroughs. Videos and screenshots live in a local library; optional cloud capabilities serve those files rather than define the product.

The cultural inspiration connects to the product's function: record, retain, and retrieve. It is not a claim that our file format or mascot reproduces historical quipu encoding. Reliability claims still need evidence; “keeping a moment” does not mean guaranteeing that no recording can ever be lost.

## Personality and voice

- **Attentive:** notice what matters and help the user make it clear.
- **Capable:** precise controls and specific language; no exaggerated performance promises.
- **Warm:** approachable without interrupting work or making errors into jokes.
- **Careful:** respect the original recording and make saved/exported states understandable.

Lead with outcomes, use short sentences, and explain local use separately from account-based cloud services. Do not market planned AI, Windows releases, or repository publication as available until their release conditions are met.

## Visual identity and Kai

Keep **Kaipu**, **kaipu.app**, the pink recognition cue, and both light/dark themes. Existing design tokens remain the implementation authority for color and contrast; this document does not redefine them.

**Kai is a fox.** Adopted by the creator on 2026-10-01, when the artwork already shipped in `packages/brand` became the identity the product and the website use everywhere. The small-knot direction explored on 2026-09-27, and the vizcacha before it, are closed: the knot lives on in the name's meaning — the khipu — not in the character. The [exploration page](/marketing/brand-and-kai/) keeps that history as history.

The artwork is a black fox bust on Kaipu pink, a flat silhouette with two cream eyes. `@kaipu/brand` resolves it by **purpose**, never by file name (`packages/brand/src/index.ts`):

| Purpose                 | Artwork                                   | Where                                                      |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `app`                   | the fox with frame corners and record dot | Dock, ⌘-Tab, DMG, the hero's identity row                  |
| `product` · `micro`     | the plain fox                             | navbars, the desktop sidebar, favicons, Kai on camera      |
| `record` · `screenshot` | capture-mode marks                        | the menu bar when recording or screenshot mode is selected |
| `permissions` · `done`  | moment marks                              | onboarding; `done` once in the home's closing              |

Where Kai appears, and what he does not do:

- **Website:** a dedicated "Meet Kai" introduction after the hero's transition; Kai as an intentionally nonliteral subject in the recording illustration's camera bubble; `done` in the closing invitation. No floating mascot, no constant animation.
- **App:** the menu-bar mark follows the capture mode; `permissions` and `done` open and close onboarding.
- **Never** as an assistant, a chatbot, automatic editing, or a promise that a recording cannot be lost.

Approved one-line introduction — EN: "Kai is the fox behind Kaipu, the companion for moments worth capturing." ES: «Kai es el zorro de Kaipu, el compañero de los momentos que vale la pena capturar.» It replaces the earlier knot caption ("Kai ties a knot so that moment isn't lost"), which described a character that was never drawn. The full landing copy is `landing.homeKaiBody`.

Still missing, tracked in [Marketing landing — Open](/backlog/marketing-landing/#open): the pink lockup as SVG, a cropped fox head for a true favicon, and a monochrome plain fox for the idle menu-bar state. An asset refresh alone does not reopen this decision.

## Sources and authority

- Creator's adopted decision and external note, **“Kaipu: origen de marca y exploración de Kai,” 2026-09-27**. Its enduring content is preserved here; no local absolute path is required to understand the brand.
- [Museo Larco — Inca Quipus](https://www.museolarco.org/en/exhibition/permanent-exhibition/online-exhibition/textiles-from-ancient-peru/inca-quipus/) supports the reference to cords and knots as a recording system. It does not validate our coined name or endorse the product.
- [Ministry of Culture publication supplied in the origin note](https://revistas.cultura.gob.pe/index.php/cuadernosqn/article/download/488/572) is an additional reference, not independent verification of the naming construction.

**Change rule:** update this page first when the creator explicitly changes the identity. Other docs link here rather than maintaining competing origin stories. Preserve the adoption date and explain any replacement decision. An asset refresh alone does not reopen the name's meaning.

## Related

- [Kai and logo exploration](/marketing/brand-and-kai/)
- [Website concept and media brief](/marketing/website-concept/) — including the [implemented origin section](/marketing/website-concept/#brand-origin-section-implemented)
- [Execution plan](/plans/2026-09-27-brand-and-website-rollout/)
- [Product philosophy](/desktop/product-philosophy/) · [Design brief](/briefings/design-brief/)
