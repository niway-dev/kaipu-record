# Landing demo clips

Drop the looping product demos here. Each feature reads three files by base name:

- `<name>.webm` — primary source
- `<name>.mp4` — fallback source
- `<name>.jpg` — poster (shown before play, under reduced-motion, and as the
  graceful fallback when a clip is absent)

Base names used by the landing: `hero`, `record`, `screenshot`, `editor`.

Guidance: 8–12s, composed to loop cleanly (end frame ≈ start frame), ~1280–1600px
wide, 30 fps, muted. Until a clip exists its section shows the poster/placeholder,
so the page ships without any file here.
