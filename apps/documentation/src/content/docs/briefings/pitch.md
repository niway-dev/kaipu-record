---
title: Pitch
description: What Kaipu Record is, why it's different, and who it's for.
---

# Kaipu Record

## The problem

You need to record your screen — a bug repro, a five-minute tutorial, a quick demo
for a teammate. The tools you reach for all make you pay for that in some other way.

QuickTime records, but that's it: no camera bubble, no annotations, no trimming — you
export a raw file and go find another app to clean it up. Loom is the opposite
problem: before you've decided whether anyone else should see the clip, it's already
uploading to someone else's servers, and you can't even start without an account.
Full editors like Final Cut or Premiere solve the editing half, but a fifteen-second
tutorial clip doesn't need a timeline with forty tracks — it needs a trim, a caption,
and an export button.

## What it is

Kaipu Record is a local-first screen and camera recorder for macOS. It records,
lets you trim and annotate right there, and exports a share-ready file — no account,
no upload, no waiting on someone else's infrastructure.

```
⌘⇧R → pick your screen (+ camera bubble) → record → trim & annotate → export
```

That's the whole loop. The file lands as a real MP4 in your own folder the moment
recording stops.

## Why it's different

**Your recording is the product, not the upload.** A recording exists the instant
it's saved to disk — playable, shareable, yours — regardless of whether it ever
touches a network. Nothing you do is gated behind a sync finishing first.

**No account to start.** Download it and record. Cloud storage exists as an optional,
paid capability for when you want a shareable link — never as a signup wall between
you and your first recording.

**A real file from the first frame, not a patched-up one.** The capture pipeline is
built on WebCodecs rather than the browser's `MediaRecorder`, so the output is a
correctly-timed, seekable MP4 from the moment it's written — hardware-encoded, at a
fraction of the CPU cost of a software re-encode, with no "fix the broken file"
step afterward.

**Editing lives in the same app.** Trim the dead air, drop in a note or a slide,
blur out a sensitive corner of a screenshot, and export — all without opening a
second, heavier tool for a clip that took thirty seconds to record.

## Who it's for

Kaipu Record is for the person who records things themselves: developers filing bug
reports, indie makers walking through a feature, anyone who needs to explain
something on screen faster than they could type it. It's also a lighter way for a
small team to pass around an internal clip than reaching for a cloud-first tool built
for company-wide rollout.

It is **not** an enterprise collaboration platform — there's no org admin, no seat
management, and no plan to add one. It's **not** a professional video editor — if you
need multi-track color grading, you still want Final Cut. And it's **not** available
on Windows yet — today it's macOS only.
