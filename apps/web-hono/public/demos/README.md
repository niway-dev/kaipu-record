# Landing demo clips

Looping product demos for the landing showcase. Each feature reads three files
by base name:

- `<name>.webm` — primary source
- `<name>.mp4` — Safari/iOS fallback
- `<name>.jpg` — poster (shown before play, under reduced-motion, and as the
  graceful fallback when a clip is absent)

Base names used by the landing: `hero`, `record`, `screenshot`, `editor`.
`hero.*` is currently a copy of `record.*` until a dedicated montage is shot —
replacing it is a plain asset drop, no code change.

## Production specs

8–12s, composed to loop cleanly (end frame ≈ start frame), **16:9**, ~1280–1600px
wide, **30 fps**, muted. Keep the `.jpg` poster the same 16:9 framing as the video
so there's no visible "pop" when playback starts (`object-cover` on an
`aspect-video` box).

Generate the fallback + poster from a source clip:

```sh
# mp4 fallback
ffmpeg -i src.webm -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -movflags +faststart -an <name>.mp4
# poster (first frame)
ffmpeg -i src.webm -frames:v 1 -q:v 3 <name>.jpg
```

Until a clip exists its section shows the poster/placeholder, so the page ships
without any file here.

## Where these live

Bundled in the repo (this folder), not R2 — see
`apps/documentation/.../backlog/landing-redesign.md` ("Assets — decisions & QA")
for the reasoning and the R2 migration trigger.
