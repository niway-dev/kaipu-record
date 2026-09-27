---
title: A warmer Kaipu and the Kai exploration
description: Preserve Kaipu's pink identity and focused UI while exploring a memorable, restrained brand companion.
---

# A warmer Kaipu and the Kai exploration

**Exploration · 2026-09-27.** The owner likes kaipu.app, the pink accent, and light/dark themes, and proposed “Kai” as an abbreviation and possible mascot. No identity replacement or mascot design is approved.

## Recommendation

Keep **Kaipu** as the product name, **kaipu.app** as its address, and pink as its recognition cue. Explore **Kai** as a supporting character rather than a second product name, a new domain, or an assumed AI assistant.

Warmth can come from understandable copy, helpful empty states, considerate spacing, clear feedback, and a small amount of illustration. It does not require turning the editor into a playful dashboard.

The existing [design brief](/briefings/design-brief/) describes compact, focused chrome and semantic colors. Preserve that operational clarity; evaluate any token changes separately in both themes.

## Where Kai could help

| Surface                       | Possible role                                         | Boundary                                                     |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| Website                       | Recognizable signature beside a genuine product story | The product demo remains the primary proof                   |
| First launch                  | A brief welcome and shortcut introduction             | Never lengthen the path to first capture                     |
| Empty library                 | A friendly invitation to make the first capture       | Keep the action direct and keyboard-accessible               |
| Release notes and support     | Consistent illustration and helpful tone              | Do not imply a real-time assistant exists                    |
| Editor and recording controls | Usually absent                                        | Avoid obstructing content, adding noise, or entering exports |

Avoid jokes in failure/recovery states, constant animations, and calling every smart feature “Kai.” A mascot can improve recognition; it does not substitute for activation or reliability.

## Visual exploration brief

- Produce a few simple silhouettes that remain identifiable at small sizes and in monochrome.
- Explore a character related to connecting or keeping explanations together; choose a specific animal or form only after testing, not by default.
- Preserve pink as the brand accent, with suitable neutral treatment in both themes.
- Keep the app icon, wordmark, tray icon, and mascot distinct in purpose. Test the current logo before assuming it needs replacement.
- Check recognition without the wordmark and whether the character makes the product feel approachable without implying a toy.

The owner associates the naming family with Quechua. Do not invent an etymology for Kaipu or Kai, or imply that an abbreviation is a verified Quechua word. Verify language-specific meanings with a qualified speaker before publishing a brand-origin story; avoid treating cultural motifs as generic decoration.

## UI improvements with higher immediate value

1. Make “saved,” “edited,” and “exported” understandable; validate the existing edit-state work rather than rebuilding it.
2. Make the primary next action obvious after capture and after export.
3. Help users distinguish the original from the edited result and navigate between them.
4. Improve toolbar hierarchy, wording, focus states, and light/dark readability through observed tasks.
5. Add warmth to onboarding and empty states once the workflow is clear.

Start with a short task-based review, not a whole-app redesign or a styling-framework migration. Measure completion time, wrong-file selections, hesitation, and ability to find an older capture.

## Decision gate

Compare the current brand with a small Kai concept in the landing and an empty state. Ask what users remember and what they think the app does. Proceed if recognition/approachability improves without hurting comprehension. If not, retain the warmer copy and existing identity. CLI feasibility and AI value do not depend on this choice.

## Peruvian-inspired directions

**Owner follow-up · 2026-09-27:** explore pixel art and a Peruvian connection. These are concept candidates, not a selected logo.

| Direction                                           | Why it could work                                                                                | What to watch                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Andean vizcacha — recommended first exploration** | Long ears, rounded body, and curved tail offer a readable silhouette; attentive and approachable | Andean, not exclusive to Peru; avoid a generic rabbit or making sleepiness its defining expression          |
| Alpaca                                              | Familiar, welcoming, and easy to recognize                                                       | Common mascot territory; needs a distinctive silhouette beyond accessories                                  |
| Abstract thread/knot companion                      | Can connect the ideas of keeping and finding                                                     | More explanation needed; do not invent an etymology or reproduce meaningful cultural patterns as decoration |

Favor a small contemporary character over a collage of tourist symbols. A subtle pink thread is a brand detail, not a claim to represent a traditional textile. Avoid default ponchos, ceremonial headwear, flags, Machu Picchu backdrops, or “Inca” styling as shorthand for Peru.

## Ready-to-use image prompt

Use this with an image-capable generator. First request concepts, then select one and iterate with that image as a reference. This prompt does not require replacing the current Kaipu logo.

> Design three clearly distinct concept variations for Kai, a small Andean vizcacha mascot for Kaipu, a focused screen-recording and screenshot app made by a Peruvian creator. The personality is observant, capable, quietly friendly, and a little curious. Make it feel like a helpful companion for people who build things, not a children's toy or an AI robot.
>
> Use deliberate pixel art on a 48 by 48 logical pixel grid per character, with crisp square clusters, a limited palette of at most eight colors, and no anti-aliasing, gradients, blur, or painterly texture. Anatomical cues: long upright ears, compact rounded body, short forepaws, and a distinct curved furry tail; do not turn it into a generic rabbit. Use warm stone gray, soft cream, dark charcoal, and one restrained hot-pink accent inspired by #F6055C. A tiny pink thread around one forepaw is optional; keep the silhouette readable without accessories.
>
> Show each variation in the same three-quarter seated pose with a calm, attentive expression. Present the three concepts separately on plain neutral backgrounds at equal scale, with generous spacing and no labels. No text, letters, logos, watermark, scenery, clothing, hats, national flags, sacred symbols, or borrowed game-character features. Keep the silhouette legible when reduced to a small UI illustration. Aim for contemporary Peruvian authorship through the animal choice and warmth, not stereotypical costume.

### Follow-up prompt after choosing one

> Use the attached approved Kai concept as the identity reference. Preserve its exact silhouette, palette, facial proportions, ears, and tail. Produce three separate full-body illustrations on transparent backgrounds: neutral attentive idle; a small welcoming wave; holding a simple rectangular capture frame with a pink corner. Keep the same three-quarter camera angle, logical 48 by 48 pixel grid, pixel size, and character scale in all three. No text, background, shadows outside the sprite, blur, gradients, or new accessories. This is a consistency sheet, not a redesign.

Generated pixel art is a concept, not automatically a production sprite: verify the grid, manually remove stray colors, and normalize proportions in a pixel editor. Export the chosen sprite at integer scales with nearest-neighbor sampling. Test against light and dark surfaces and in monochrome. Create an independently simplified favicon/tray mark only if needed; a full 48-pixel character will not necessarily read at 16 pixels. Transparent output may need cleanup depending on the generator.

For the [website concept](/marketing/website-concept/), start with one static Kai illustration near the closing invitation or an empty-state example. Add animation only after the character and page hierarchy work without it.
