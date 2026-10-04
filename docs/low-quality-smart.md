# Low-quality Smart best — 1.27.0

Implemented: source diagnostics (noise, codec grid seams, softness, exclusion of constant bars for analysis); motion-aligned two-frame cleanup with bidirectional flow/occlusion rejection; optional verified Real-ESRGAN compact strong/weak denoise weight blend on MPS/CUDA/CPU; tiled bounded inference; source-preserving blend; detail/tone protection; desktop text bypass; soft subtitle-like region protection; genuine 2x for small containers; native resolution repair for larger containers. Above a 960-pixel long side, neural inference uses a 640-pixel guide and applies a bounded residual to the native frame, protecting strong native edges. The original is never replaced with a downscaled/upscaled frame; this path does not reconstruct native fine detail.

Background viewing uses four-second chunks and a muted video overlay synchronized to the original clock. The source always provides audio and transport. No heavy model lies on click/seek execution. Continuous recording parts carry the Smart best selection to their next source. Completed chunks are reused in this viewing session; arbitrary seeks display the source until their chunk is ready. Browser cache is 128 MiB / six chunks; helper completed output is 256 MiB / six chunks plus one pending chunk. Original uploads are limited to 1.6 GB each, two sessions. Session DELETE cancels the worker and removes private cache; ten-minute abandonment cleanup and startup cleanup cover disconnected tabs. No library data or pairing is replaced.

Manual exit clears media and enhancement state. Five minutes without pointer, keyboard, wheel or input closes playback even while playing, per the requested privacy behavior. Recording playback state is saved; unsaved recordings retain a download recovery action. Local files remain on disk. Neither exit deletes recordings.

Limitations: this is motion-aligned filtering plus a spatial restoration network, not a trained temporal SR network. It does not claim Core ML conversion, true SDR-to-HDR reconstruction, recovery of original missing face details, exact effective-source resolution or parity with Topaz. The playback cache uses CRF 15 H.264 4:2:0 and is ephemeral; archival export remains separate.

Measured synthetic M4 Pro tests: warm 640x360 Real-ESRGAN 2x inference about 0.437 seconds/frame. Actual decode→MPS repair→H.264 encode of a one-second, 320x180 / 12 fps blurred and compressed clip produced a 640x360 clip in 2.59 seconds using the initially verified environment. These are synthetic speed measurements, not real-video quality or competitor benchmarks.

Additional final-engine synthetic benchmark: warm 640x360 MPS 2x inference with larger tiles: 0.241 / 0.233 seconds/frame. Native 1920x1080 guide-residual output retains size and protected step edges; tested output delta was at most 7 levels, within the 12-level guide bound.

## Unified playback workflow

Smart best is the only restoration entry point. Library actions open Smart best playback; offline restoration and batch-enhancement controls are removed. Historical recordings and processed results remain available. Heavy repair uses temporary synchronized chunks on the local helper, without cloud uploads.

## Seek priority and presentation stability

A seek more than one chunk away cancels unrelated work without uploading the source again or discarding completed chunks. Current playback repair is submitted before prefetching. Cached video becomes visible within 60 ms of the source clock and remains visible until drift exceeds 120 ms; larger drift falls back to the original frame while the secondary clock catches up. Original audio remains authoritative.
