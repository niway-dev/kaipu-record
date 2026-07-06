---
title: Vital flows — what to secure and how
description: Which kaipu-record flows are existential to the product, honestly mapped against what automated tests can actually guarantee — and the layered plan for the one vital flow (recording) that resists headless testing.
---

# Vital flows — what to secure and how

The [flow testability map](/testing/) asks "how testable is each flow?". This page asks the
sharper question: **which flows are _vital_ — the product is worthless if they break — and how
much of each can we actually guarantee automatically?**

## What "vital" means here

Kaipu is a **screen recorder**. Vital is not what's polished — it's what, if broken, leaves the
product with no reason to exist. Ranked by that:

| #     | Vital flow                                                              | Why it's vital                                                                 |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **1** | **Record → save a valid (non-corrupt) video**                           | This _is_ the product. A corrupt file is the worst outcome — lost work.        |
| **2** | **Access / play your recordings** (library + playback)                  | Recording is pointless if you can't retrieve the file.                         |
| **3** | **Permissions / onboarding**                                            | Without screen/mic permission, recording fails silently. The front door.       |
| **4** | **Options actually apply** (mic on ⇒ audio in the file; correct source) | A "successful" recording with no audio or the wrong screen is still lost work. |
| 5     | Video editor (trim / export)                                            | Value-add, not existential.                                                    |
| 6     | Screenshot capture + edit                                               | Value-add.                                                                     |
| 7     | Settings, shortcuts, rename/delete/reveal                               | Peripheral.                                                                    |

## The uncomfortable truth

**The #1 vital flow — recording — is the one we can least test headless.** Everything we have
secured so far (library, playback, editors, settings) sits _downstream_ of capture. The heart
of the product is native + H.264:

- Capture: `getUserMedia({ chromeMediaSource: "desktop", … })` — needs the OS screen-recording
  permission and a real `desktopCapturer` source (`recorder-engine.ts`).
- Encode: mediabunny `Mp4OutputFormat`, video `codec: "avc"` (H.264) + `aac`
  (`recorder-engine.ts`) — the same encoder that is unavailable on headless Linux CI.

## Vitality × what we can actually secure

| Vital flow                                | Securable?                                                                                | Status               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------- |
| 1. Record → valid video                   | 🟡 **In layers** (below). Not the OS grab; yes almost everything else                     | ⚠️ the real gap      |
| 2. Library + playback                     | 🟢 Yes, headless                                                                          | ✅ secured           |
| 3. Permissions / onboarding               | 🟡 UI + gating with stubbed status; the real grant, no                                    | ◻️ partial, pending  |
| 4. Options apply                          | 🟡 options→IPC→engine config (contract); "audio truly in the file" needs a real recording | ◻️ pending           |
| 5. Editor export                          | 🟡 macOS + red-green; skips on Linux                                                      | ✅ secured           |
| 6. Screenshot edit / capture              | 🟢 edit / 🔴 capture                                                                      | ✅ edit / ◻️ capture |
| 7. Settings / shortcuts / library actions | 🟢                                                                                        | ✅ secured           |

The good news: the whole product _except capture_ is secured or deterministically securable.
What remains are the two most vital flows — #1 and #3.

## The layered plan for recording (flow #1)

This is not "can we test it or not." It's **how much of the chain**
`capture → encode → mux → save → register in the library` each layer covers:

### L1 — Contract tests (every PR, everywhere) 🟢

The seed already exists: `recorder-engine.test.tsx` mocks mediabunny to observe the engine's
wiring. Extend it to cover the start/stop state machine (`recorder-store`), that the engine
acquires the streams and configures the right output, and that stopping **writes the file and
registers it in the vault + sidecar**. This secures _our_ orchestration — the ~80% that is our
code — without touching anything native. Highest leverage, runs on every PR.

### L2 — Synthetic-stream E2E (macOS, skips Linux) 🟡

Instead of asking the OS for the screen, **inject a `canvas.captureStream()`** by stubbing
`getUserMedia` in the renderer, and let the _real_ engine run → real H.264 encode → real file →
validate with `ffprobe`. This secures `stream → encode → mux → save → valid` end-to-end
**without permissions or `desktopCapturer`**. It skips on headless Linux (H.264), exactly like
the export test.

> **Needs a small spike first** to confirm Electron + mediabunny accept an injected
> `MediaStream` in place of the desktop-capture stream. Treat L2 as validated only after that.

### L3 — Manual / release smoke (macOS) 🔴

The real TCC screen-recording permission + real capture. This is the irreducible part — not
even a macOS CI runner can grant screen-recording permission headless. Cover it with a release
smoke checklist, not code.

> In one line: we can guarantee that **"given a stream, we produce a valid video and save it
> correctly" — what we cannot automate is "the OS hands us a real stream."** That last
> centimetre stays manual.

## Recommended order

1. **L1 for recording** — the contract (start → engine → stop → valid file in vault). Highest
   leverage: deterministic, every PR, covers the largest surface of the most vital flow.
2. **L2** — the synthetic-stream test (after the spike) to secure the real encode on macOS.
3. **Permissions/onboarding (flow #3)** — test the UI + gating with a stubbed permission status;
   the real grant stays in the L3 smoke checklist.
4. L3 release smoke checklist for the native/TCC parts of #1 and #3.
