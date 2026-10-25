# Product foundations — October 25, 2026

## Recording acceptance

`python3 scripts/check-media-runtime.py --output /tmp/media-runtime.json` performs actual encode/decode checks. This Mac passed libx264 and hardware-only VideoToolbox smoke tests. Native screen capture is not tested by this probe and no replacement native capture engine is claimed.

`node scripts/soak-recording.cjs --seconds 30 --rotate-seconds 10 --output /tmp/recording-soak` runs the actual extension MediaRecorder and IndexedDB pipeline with synthetic audio/video. The completed local run produced three segments totaling 30.357 seconds; all had audio/video streams and decoded at sampled beginning/middle/end positions. Failed runs retain their isolated browser profile for recovery.

For an eight-hour real source acceptance run, use `--seconds 28800 --rotate-seconds 300 --source screen` and select the source in the browser picker. Keep output on a disk with adequate space. This long run has NOT been completed. Progress is written to progress.json; final checks go to report.json.

## Reproducible quality comparison

Use the helper Python environment:

```bash
python scripts/compare-video.py prepare --case /tmp/my-comparison --source /path/source.mp4 --start 10 --seconds 8
python scripts/compare-video.py run --case /tmp/my-comparison --engine spatial
python scripts/compare-video.py run --case /tmp/my-comparison --engine neural
python scripts/compare-video.py report --case /tmp/my-comparison
```

All engines receive the exact hashed input.mp4. Outputs must match dimensions, frame rate, and duration. Preparation may normalize large inputs to at most 1080p/30 fps and never upscales smaller sources; this is a controlled comparison, not an original-resolution quality claim. Optional `--reference` must be a truly aligned pristine reference; SSIM is reported only when supplied. File size and speed do not determine a quality winner.

The local 640×360, four-second noisy fixture ran 120 neural invocations on MPS. Spatial took 5.898 seconds; neural took 32.432 seconds (3.7 rendered fps). This fixture does not establish real-time capability or broad quality superiority. Review A/B motion and texture visually before judging.

Open review.html for randomized A/B playback and JSON scoring export. The answer key is separate. Per user preference Topaz was not installed. Later export from Topaz using the exact input/spec, then register the real result:

```bash
python scripts/compare-video.py add --case /tmp/my-comparison --label topaz --file /path/topaz.mp4 --elapsed 60
python scripts/compare-video.py report --case /tmp/my-comparison --engines neural,topaz
```

## Managed helper installation

`enhancement/install-wescreen.command` is the macOS setup/update entry point. It reuses an existing LaunchAgent location and model runtime. `--with-smart` explicitly installs optional models. It verifies packaged code/model integrity, stages changed code, records backups, and checks the running helper build/protocol after launch. Existing recordings, jobs, tokens, and model runtime remain in place.

New helpers implement an authenticated maintenance lease to block new processing requests during updates. Busy helpers refuse updates. `--rollback` restores the latest code transaction; dependency downgrades and operating-system snapshots are not included. Browser extension loading and permissions remain browser-controlled. Windows/Linux managed installers and a signed standalone installer remain future work.

Local helper now runs version 1.29.0 / protocol 2 with the neural model ready. Frontend compatibility diagnostics and installation guide were copied to the existing installed-1.29.0 directory. Reload the extension to pick up frontend changes.

## Follow-up: durable blind reviews and repeat installation

Reports now retain their A/B mapping and review ID when the compared output hashes are unchanged. Exported votes carry the review ID and input hash; stale-session votes, changed media, invalid fields and empty ratings are rejected. Identical vote files are imported only once. Import a real exported score with:

```bash
python scripts/compare-video.py score --case /tmp/my-comparison --file /path/blind-review.json
```

`score-summary.json` counts preferences against the actual engine names, per category, without inferring statistical superiority. Different valid reviews may come from the same person; deduplication is file-based, not identity verification. Reports for a different engine pair create a different session; previous score files stay on disk but do not enter the new summary.

Repeated in-place installation and staging failures now release the maintenance lease. Busy refusals do not clear another update's lease. Successful code replacement keeps maintenance active until helper restart.
