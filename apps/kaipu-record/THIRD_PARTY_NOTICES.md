# Third-party notices

Kaipu Record downloads or runs the third-party software and models listed below for local
transcription (NIW2-818). Each entry says how its facts were checked: **verified** means read from
the pinned artifact or its upstream page on the date given; **not verified** means stated from
upstream's published terms and not re-read against the pinned artifact.

## Speech recognition model (downloaded, not bundled)

### NVIDIA Parakeet TDT 0.6B v3 and v2 (int8 ONNX conversions)

- Credit shown in the app: "Speech recognition: NVIDIA Parakeet (CC-BY-4.0)".
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

## Not done yet

The full Apache-2.0 and MIT license texts are not copied next to the binaries. A release that
ships the engine should bundle them; tracked in the PR that introduced this file.
