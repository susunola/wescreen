# Screen-content tuning

Measured with `bench/screen_tune.py` on the synthetic corpus (1280×720, 30 fps, 5 s; software encoders, 2-core container). Edge PSNR is text-edge sharpness in dB (higher is better). Raw rows: `results/tune-*.jsonl`.

## SVT-AV1 screen-content mode (`scm=1`), preset 6, CRF 38

| Clip | Without scm | With scm | Bytes | Edge PSNR |
|---|---:|---:|---:|---:|
| code_scroll | 290 kbps | 127 kbps | -56% | 46.2 → 47.4 |
| slides_static | 134 kbps | 60 kbps | -56% | 47.2 → 48.8 |
| ui_mixed | 383 kbps | 322 kbps | -16% | 40.3 → 40.6 |
| web_scroll | 667 kbps | 509 kbps | -24% | 46.5 → 47.8 |

## Other encoders' screen-content switches

| Encoder | Result |
|---|---|
| libvpx-vp9 `-tune-content screen` | no effect through FFmpeg: byte-identical output on every clip |
| x265 `limit-sao=1:rskip=2:tskip=1` | within ±5% bytes and ±0.5 dB: not worth the complexity |

## SVT-AV1 + scm=1: preset (speed) × CRF

Encode time is for a 5 s 720p30 clip on 2 cores; the real-time factor is encode time ÷ clip length.

| Clip | Preset | CRF | kbps | Edge PSNR | Encode time |
|---|---:|---:|---:|---:|---:|
| code_scroll | 10 | 42 | 158 | 44.5 | 9.6 s |
| code_scroll | 10 | 50 | 132 | 41.0 | 9.3 s |
| code_scroll | 6 | 42 | 114 | 45.8 | 16.5 s |
| code_scroll | 6 | 50 | 95 | 42.4 | 17.0 s |
| code_scroll | 8 | 42 | 138 | 45.4 | 11.9 s |
| code_scroll | 8 | 50 | 114 | 41.8 | 11.2 s |
| ui_mixed | 10 | 42 | 257 | 38.8 | 8.4 s |
| ui_mixed | 10 | 50 | 98 | 37.4 | 8.0 s |
| ui_mixed | 6 | 42 | 131 | 40.1 | 20.6 s |
| ui_mixed | 6 | 50 | 69 | 38.7 | 18.0 s |
| ui_mixed | 8 | 42 | 186 | 39.7 | 11.1 s |
| ui_mixed | 8 | 50 | 90 | 38.5 | 10.9 s |
| web_scroll | 10 | 42 | 483 | 43.7 | 9.6 s |
| web_scroll | 10 | 50 | 368 | 39.7 | 10.1 s |
| web_scroll | 6 | 42 | 461 | 45.8 | 20.2 s |
| web_scroll | 6 | 50 | 346 | 42.1 | 19.5 s |
| web_scroll | 8 | 42 | 500 | 45.1 | 11.6 s |
| web_scroll | 8 | 50 | 374 | 41.1 | 12.0 s |

## Browser (WebCodecs AV1, real-time) with a screen-content hint

`contentHint: 'text'` on Chromium's AV1 encoder, `standard` bitrate target, same frames (`results/browser.jsonl`, `WebCodecs av1-vbr` vs `av1-text`):

| Clip | No hint | `contentHint: text` |
|---|---:|---:|
| code_scroll | 1806 kbps, edge 34.88 | 1669 kbps, edge 36.81 |
| slides_static | 482 kbps, edge 42.25 | 265 kbps, edge 45.99 |
| ui_mixed | 3037 kbps, edge 35.15 | 3103 kbps, edge 37 |

## Caveats

- Synthetic clips: they exercise text, scrolling and UI, but real recordings differ. Re-run `screen_tune.py` on `--import-video` clips before treating the percentages as promises.
- `video_motion` was not part of these runs; screen-content tools target text and flat UI, not camera footage.
- SVT-AV1 at preset 6 is slow (~3.4× real time here); the helper defaults to preset 8 and offers `effort`. AV1 MP4 plays in Chrome, Edge and Firefox; older Safari/QuickTime may not play it.
