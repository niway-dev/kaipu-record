# Third-party notices

Kaipu Record downloads or runs the third-party software and models listed below for local
transcription (NIW2-818). Each entry says how its facts were checked: **verified** means read from
the pinned artifact or its upstream page on the date given; **not verified** means stated from
upstream's published terms and not re-read against the pinned artifact.

## Speech recognition model (downloaded, not bundled)

### NVIDIA Parakeet TDT 0.6B v3 and v2 (int8 ONNX conversions)

- Credit shown in the download prompt (`attribution` in `src/main/transcription/models/catalog.ts`):
  "Speech recognition: NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0). Weights by NVIDIA, int8 ONNX
  conversion by the sherpa-onnx community." (v2 for the other entry).
- License: Creative Commons Attribution 4.0 International (CC-BY-4.0),
  <https://creativecommons.org/licenses/by/4.0/>. The model is by NVIDIA; Kaipu changes nothing in
  the weights.
- Upstream: <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3> (verified in invisible-assistant's
  provenance ledger, 2026-10-27; not re-read here).
- What the app downloads: the int8 ONNX conversion made by the sherpa-onnx community,
  `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` at revision
  `2bda32ec70b097a55adaa07d9a7173915b43cc78` (v2: `...-v2-int8` at
  `1ab9323565ddb038682214b292f588070a538ce2`). The revisions and per-file SHA-256 are pinned in
  `src/main/transcription/models/catalog.ts`; sizes and hashes of the large files were confirmed
  against the Hugging Face headers on 2026-11-15 (verified).
- The files are fetched at the person's request, stored in the app's data folder and never part of
  the installer.

## Bundled engine (inside the signed arm64 app, `resources/native/sherpa-onnx/`)

### sherpa-onnx `sherpa-onnx-offline`, release `v1.13.8`

- License: Apache-2.0, <https://www.apache.org/licenses/LICENSE-2.0>. Upstream:
  <https://github.com/k2-fsa/sherpa-onnx> (not verified against the release archive's own
  `LICENSE`).
- Pinned in `scripts/speech-engine.lock` with the SHA-256 of the release archive (verified).
- Kaipu runs it as a separate process; it does not link it.

### ONNX Runtime `libonnxruntime.dylib`

- License: MIT. Upstream: <https://github.com/microsoft/onnxruntime> (not verified against the
  copy inside the sherpa-onnx archive).
- Shipped inside the sherpa-onnx release archive and copied next to the CLI.

## Where the notices are

- The Apache-2.0 and MIT texts that sherpa-onnx's own release archive carries (its top-level
  `LICENSE*`, `NOTICE*` and `COPYING*` files) are copied by `scripts/fetch-speech-engine.sh` into
  `resources/native/sherpa-onnx/licenses/`, next to `bin/` and `lib/`, and ship inside the app. The
  fetch fails if the archive has none, and the release checks that the folder is not empty, both
  before packaging and in the packaged arm64 app.
- The app has no screen that lists third-party notices (NIW2-818 tracks local transcription). The
  model credit is shown in the download prompt. This file is the repository's record.
- Not verified: which files the pinned archive actually holds, and whether it carries a separate
  ONNX Runtime license text. Nobody has run the fetch against the real archive since the license
  copy was added; a failed fetch would say so.
