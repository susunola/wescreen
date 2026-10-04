# Low-quality Smart best

Implemented: same-size spatial restoration bypasses neural upsample/downsample; adaptive flat-region noise cleanup; bounded weak codec-grid seam cleanup; luma detail and tone protection; optional genuine FSRCNN 2x; exact decoded-frame session cache capped at 24 MiB and cleared on stop, source change, exit. Existing generation and timestamp guards prevent late results covering new video. No frames persist to disk.

This is not a temporal neural model or Core ML engine. No new weights were installed. Full segment restoration caching, effective-resolution analysis and aligned multi-frame restoration remain future work and require real-video comparisons and Mac model benchmarks before default activation. HDR keeps the native path.

Measured on M4 Pro: 1280x720 synthetic noise input, same-size processing (text protection off), 5 calls: 103.6 / 55.5 / 54.2 / 54.8 / 54.3 ms. This excludes browser transport/rendering and is not a video FPS benchmark.
