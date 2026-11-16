# Transcription M0 spike (NIW2-818)

Measures Parakeet TDT 0.6B v3 int8 through the `sherpa-onnx-offline` batch CLI on whole recordings,
to choose the segmentation, the batch size and the sherpa-onnx release. The results, with the
machine named, are in
[ADR 0062 "M0 results"](../../../../documentation/src/content/docs/architecture/decisions/0062-speech-recognition-runs-in-a-bundled-sherpa-onnx-cli-with-a-downloaded-pinned-model.mdx).
Nothing here ships; the production modules are in `src/main/transcription/`.

The script never prints or saves transcript text. `--save-words` writes the words to a path you
choose; keep it outside the repository.

## What you need

- A sherpa-onnx release unpacked so that `<runtime>/bin/sherpa-onnx-offline` exists (v1.13.8 and
  v2.0.1 were measured). Use a fresh empty directory for a downloaded archive.
- The Parakeet v3 int8 model directory (`encoder.int8.onnx`, `decoder.int8.onnx`,
  `joiner.int8.onnx`, `tokens.txt`).
- `bun`, `ffmpeg`, and on macOS `say` for the synthetic fixtures.

## Make the inputs

16 kHz mono 16-bit WAV, cut with ffmpeg from a recording:

```bash
ffmpeg -i recording.mp4 -t 300 -ac 1 -ar 16000 -c:a pcm_s16le r05.wav
```

Synthetic fixtures with known words (the answer key a real recording does not have):

```bash
bun make-fixtures.ts /tmp/m0-fixtures <prose files...>
```

It writes a continuous English passage and a Spanish passage with their true words, and two
word-by-word files with the true start and end of every word (marks by construction, exact, no ear
needed; the spec's "hand-marked words" is replaced by this).

## Run

```bash
bun run.ts --audio r20.wav --runtime <sherpa dir> --model <model dir> \
  --strategy fixed --batch 4 --rule midpoint-dedupe
```

| Flag                                        | Meaning                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `--strategy single`                         | the whole file in one CLI call (reference)                              |
| `--strategy fixed`                          | windows of `--window-ms` (30 000) overlapping by `--overlap-ms` (3 000) |
| `--strategy energy`                         | energy VAD regions, padded, long ones split with overlap                |
| `--batch N`                                 | segments per CLI call                                                   |
| `--rule spec / midpoint / midpoint-dedupe`  | how overlapping segments are joined (see `words.ts`)                    |
| `--truth words.json` / `--marks marks.json` | score against the true words / the true word times                      |
| `--reference words.json`                    | score against another run's saved words                                 |

It prints one JSON object: wall time of the CLI calls, peak RSS of the CLI (one process, read from
`/usr/bin/time -l`), segment and seam counts, words, `emptyWithSpeech` (segments with at least one
second of voiced frames and no words), `adjacentDuplicates`, and the comparison with the truth,
marks or reference when given.
