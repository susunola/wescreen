# WeScreen encoder benchmark

Measures what the recorder actually produces, so quality, file-size and format work is decided by numbers instead of taste.

Every encoder is fed the same lossless frames and judged against the same reference with the same metrics:

| Metric | Why |
|---|---|
| `mb_per_min`, `kbps` | File size at a given length |
| `edge_psnr` | PSNR over edge pixels only (Sobel > threshold). This is the "is the text still sharp" number; whole-frame PSNR is dominated by flat areas and hides blurry text |
| `ssim`, `psnr` | Whole-frame sanity checks |
| `frames_decoded / frames_expected` | Dropped or duplicated frames, with automatic offset alignment |

## Run it

```bash
# 1. Synthetic corpus (deterministic, no downloads). Or import a real screen capture:
python3 bench/make_corpus.py --out bench/corpus
python3 bench/make_corpus.py --import-video my_recording.mp4 --name my_demo   # needs ffmpeg

# 2. Reference points: FFmpeg CRF encoders + an ABR "realtime proxy" at the extension's bitrates
python3 bench/ffmpeg_sweep.py

# 3. Browser encoders: MediaRecorder (today) vs WebCodecs + Mediabunny
cd bench && npm install
node browser_bench.mjs --suite quick --chrome "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headed
node browser_bench.mjs --capabilities        # what this browser can encode

# 4. Report
python3 bench/report.py > bench/RESULTS.md
```

`python3 -m unittest tests/bench_test.py` covers the metric helpers, the interpolation, the report, and checks that the Python port of `videoBitrate()` still matches `recorder.js`.

## What the numbers do and do not mean

- **The corpus is synthetic.** It exercises the right failure modes (static slides, scrolling code, scrolling web, natural video, mixed UI) but is not your screen. Import a real clip with `--import-video` before trusting a ratio.
- **`realtime-proxy` is not Chrome.** It is x264 `veryfast zerolatency` ABR at the bitrate the extension requests. It shows what a rate-targeted real-time encoder does; it is not a measurement of `MediaRecorder`.
- **Hardware encoders only appear on real hardware.** A headless cloud container tests software VP8/VP9/AV1/H.264 only. Run `browser_bench.mjs` on the Macs and PCs your users have; hardware H.264/HEVC/AV1 are the point of the WebCodecs engine.
- **MediaRecorder rows run in real time**, so a loaded machine can drop frames; check the frame counts and do not run other heavy work meanwhile.
- Ratios are interpolated in log-size between measured points and never extrapolated; a dash means the target quality lies outside what was measured.
