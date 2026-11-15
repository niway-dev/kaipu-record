# A/V sync fixtures

Inputs for `verify/av-sync.verify.ts` (NIW2-807). Each file is the same 10 s take:
1280×720 at 30 fps, 48 kHz stereo AAC, dark frames, and at 2, 4, 6 and 8 s a white flash
(two frames) and a 1 kHz beep (80 ms) that start on the same instant. Played correctly,
every beep starts exactly with its flash.

| File         | Written by                                                                     | Offset as a player sees it (`e2e/helpers/av-sync.ts`)                            |
| ------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `ffmpeg.mp4` | ffmpeg (libx264 + native AAC), edit list `media_time=1024` for the AAC priming | +0.0 ms                                                                          |
| `mb161.mp4`  | mediabunny 1.61.4 in Chrome 157 (macOS AudioToolbox AAC)                       | +44.0 ms: no priming compensation, the encoder's 2112 priming samples play first |
| `mb166.mp4`  | mediabunny 1.66.0 in the same Chrome                                           | +0.0 ms: edit list `media_time=2112`                                             |

`mb161.mp4` has the same structure as every recording made before the mediabunny 1.66
upgrade, so it stands for the takes already in users' libraries.

## Regenerating

`ffmpeg.mp4`:

```bash
E='gte(t,2)*lt(t,2.08)+gte(t,4)*lt(t,4.08)+gte(t,6)*lt(t,6.08)+gte(t,8)*lt(t,8.08)'
ffmpeg -y \
  -f lavfi -i "color=c=0x202020:s=1280x720:r=30:d=10,drawbox=x=0:y=0:w=iw:h=ih:c=white:t=fill:enable='between(n,60,61)+between(n,120,121)+between(n,180,181)+between(n,240,241)'" \
  -f lavfi -i "aevalsrc='0.5*sin(2*PI*1000*t)*($E)|0.5*sin(2*PI*1000*t)*($E)':s=48000:d=10" \
  -c:v libx264 -pix_fmt yuv420p -g 60 -b:v 4M -c:a aac -b:a 128k ffmpeg.mp4
```

`mb161.mp4` and `mb166.mp4`, from `apps/kaipu-record` with system Chrome installed:

```bash
PKGS=$(mktemp -d); OUT=$(mktemp -d)
(cd "$PKGS" && npm pack mediabunny@1.61.4 mediabunny@1.66.0 \
  && mkdir v161 v166 \
  && tar xzf mediabunny-1.61.4.tgz -C v161 && tar xzf mediabunny-1.66.0.tgz -C v166)
node verify/fixtures/av-sync/generate/gen.mjs "$PWD/node_modules/@playwright/test" "$PKGS" "$OUT"
# writes $OUT/fixture-mb161.mp4 and $OUT/fixture-mb166.mp4
cp "$OUT/fixture-mb161.mp4" verify/fixtures/av-sync/mb161.mp4
cp "$OUT/fixture-mb166.mp4" verify/fixtures/av-sync/mb166.mp4
```

Then re-run `e2e/helpers/av-sync.test.ts`: it pins each file's offset.

The encoder is not bit-exact between runs, but the offsets are: two runs gave +44.0 ms and
+0.0 ms on every event.
