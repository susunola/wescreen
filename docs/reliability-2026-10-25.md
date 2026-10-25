# Recording and playback reliability, 2026-10-25

## Recording and storage

- A rejected resolution cap cancels recording before encoding. Re-share or explicitly choose source resolution to proceed; no silent oversized fallback.
- Course, everyday and motion presets set resolution, bitrate class, frame rate, content hint and audio bitrate together. Course uses 1080p / compact / 24 fps / text / 128 kbps audio. Existing manual settings remain available.
- Live diagnostics show measured output size per hour and warn when measured rate exceeds the target by 50% after 20 seconds. Preview frame counts remain labeled as preview statistics.
- Disk segments retain per-chunk SHA-256 receipts. After closing the disk file, each written region is checked against its source receipt. Disk-only archival additionally checks first-frame decoding before replacing the browser recovery copy with a file index.
- Incomplete or mismatching disk files retain the browser copy. A failed recovery chunk write does not discard the current in-memory recording. Completed segments remain independent transactions.
- File-backed recordings can be relinked using their stored chunk receipts if the original handle becomes unavailable. Legacy recordings retain their existing comparison path.

## Smart best

- Current playback and nearby chunks remain prioritized. Completed helper cache entries are reused independently of browser RAM eviction.
- Failed repair chunks have a three-attempt limit with backoff. Three consecutive transport failures stop automatic polling; explicit retry resets the failure state. Chunk requests have a 30-second network deadline, separate from inference progress polling.
- A periodic authenticated heartbeat keeps playback sessions alive while the page remains open. Returning from system sleep can renew an expired session from the original source and reuse persistent repair chunks.
- Clean diagnosed frames at original size bypass unnecessary sharpening/tone changes. Cache policy is bumped so previous policy results are not silently reused.

## Maintenance and diagnostics

- About → Storage & diagnostics displays browser usage, helper job files, uploads, derivative repair cache, staging sources and helper-volume free space separately. It does not claim free space for an arbitrary external recording drive.
- Cache cleanup only removes inactive SHA-256-named derivative cache directories. Active assets, staging sources, unknown directories, original recordings and completed jobs are preserved. Existing cache limit remains 8 GiB.
- Diagnostics export whitelists aggregate counts, capability flags, versions and bounded error codes. No file paths, media names, tokens or raw error messages are exported. All maintenance endpoints require helper authentication.

## Quality baseline and limits

Run `enhancement/.venv/bin/python scripts/benchmark-quality.py --output <directory>` for deterministic clean/noise/blur/compression/mixed fixtures, source/restored PNGs and reference PSNR. These single-frame non-neural measurements are not a perceptual quality guarantee or a competitor comparison. Real motion, faces, skin texture, text and neural processing need separate visual review.

Fault tests cover failed recovery writes, same-size disk corruption, incomplete disk files, cache cleanup scope, authenticated aggregate storage endpoints, limited chunk/transport retries and diagnostic privacy. UI checks cover six tabs, local playback, native fullscreen, Chinese/English and three narrow window widths.

No new multi-hour real recording soak has been completed in this change. Short automated rollover and crash/reopen fixtures verify specific failure paths, not eight-hour reliability, external-drive disconnection or every browser/OS combination.
