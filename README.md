# WeScreen

[中文](README.zh-CN.md) · Local screen/video recording for Chrome and Microsoft Edge.

## Install

Load this directory as an unpacked extension from your browser's extension developer page, or extract `store/wescreen-1.8.0.zip` and load it. Click WeScreen to open the recorder. Update/reload the extension after changing files; close old recorder pages before the database upgrade.

## Workflow

- Telegram channel profiles retain links, independent numbering, a message recording plan and download subfolders. Completed recordings advance to the next planned item; the library filters by channel and links back to the source message. Screen sharing still requires the browser picker.
- Record a screen, window or tab. MP4 requires native H.264 + AAC encoder support; WebM is available otherwise. The source picker controls shared audio.
- Use Library for playback, search, sorting, course records, imports and last export location. Moving to Trash is reversible; permanent deletion does not remove exported disk files.
- Recordings are stored in extension IndexedDB, with unlimitedStorage and a persistent-storage request. There is no fixed 10 GB library cap. Disk space is finite. Long recordings automatically rotate near 800 MB to bound memory; no single in-memory segment should reach the 1.6 GB ceiling. A small boundary overlap is possible.
- Optional camera composition uses a worker frame pipeline rather than visible-page animation. Unsupported browsers fail clearly; direct screen capture remains available without the camera.
- Telegram preset: pause the video, choose the Telegram tab with shared audio, then play after the countdown. Audio availability for a desktop window depends on the operating system. Use crop/trim to keep only the player and remove waiting time.

## Editing and enhancement

Download/extract the separate helper package or use the repository. Install Python 3.10–3.13 and FFmpeg, then run `bash enhancement/start.sh`. The extension connects automatically; manual token entry remains under Advanced connection settings. On macOS you can open `enhancement/start.command`.

Natural restoration is the default. FSRCNN offers lightweight 2× enhancement; SeedVR2 is optional and requires `bash enhancement/install-seedvr.sh` (about 7 GB of weights). Preview 3, 5 or 10 seconds from the current playback position, compare synchronized playback or native-size detail, then process a full video. AI may invent details; output is SDR, not HDR.

Crop/trim saves a new MP4. Full results remain in `enhancement/.runtime/jobs` until explicitly deleted. Processing tasks can be reopened, saved to Library again after a failure, or streamed directly to a file. Completed results survive helper restarts; interrupted tasks must be rerun. One task runs at a time. Completed results have no fixed count cap; available disk space limits retention. No videos go to an external processing service. See [helper guide](enhancement/README.md) and [privacy policy](PRIVACY.md).

## Verification and packaging

```sh
node --test tests/*.test.js
enhancement/.venv/bin/python -m unittest discover -s tests -p '*_test.py'
WESCREEN_SEEDVR_TEST=1 enhancement/.venv/bin/python -m unittest discover -s tests -p '*_test.py'
python3 scripts/build-package.py
```

Browser tests require Playwright and Chromium; if absent those tests are skipped. Tests include cross-page recovery, slow storage, worker composition, native media playback, trash/restore, quota failures and result retention. Synthetic fixtures verify the pipeline, not restoration quality on real Telegram content. Validate long sessions, audio sync and OS/browser support separately before release.

[Source](https://github.com/susunola/wescreen) · [Current changes](CHANGELOG.md)

## Professional capture and playback (1.16)

New controls stay inside the existing advanced menus: recording → advanced settings → Professional capture & audio; player → More → Professional playback tools; library → File management. See [feature coverage and verification](docs/professional-1.16.md).

Select a recording folder to write an additional disk copy in safe segments (256 MB threshold), while the original and recovery chunks remain in the browser library. Folder permission must remain granted. This does not trigger browser downloads. Monitoring reports preview frame delivery/drops, not encoder frame statistics. Independent audio is optional and follows recording pauses; download or delete it in File management.

Select one continuous recording and use Merge for compatible-stream copying, or Compatible merge for explicit re-encoding. Results stay in the helper until manually saved or exported. Originals remain available. Large merged files can be exported directly without first importing them into the library; library import still has a 1.6 GB per-file limit.

On macOS, run the helper's `install-launcher.command` once after dependencies are installed. The extension's Start local helper link then launches or updates the managed helper without interrupting an active processing job. The installer retains existing models and recordings. The helper package is separate from the Edge Store extension package.

## 1.6 workflow additions

Channel workbench supports reorder, skip, rerecord and duplicate links. Recording diagnostics show preview fps/dropped frames, last completed writes and missing audio signals. A persisted sequential enhancement queue supports pause after the current job, resume and retries. Editing supports clockwise/counterclockwise 90° and arbitrary rotation, plus a 1920×1080 landscape canvas, preserving originals and audio. Border suggestions use the current frame only and require visual checking. Channel crop preferences and synchronized detail zoom are available. Token-file import simplifies pairing. Existing Homebrew installations can install missing FFmpeg/Python when starting; other systems still need prerequisites.

### Continuous Telegram recording

Check the shared picture and audio before starting. Open the separate control window to pause, resume or stop. Save the current video and prepare the next to retain the shared source while paused. Copy the next message link and open it in the original shared tab before resuming. Review start/middle/end thumbnails, inspect suggested black-screen trims, and remember crop/rotation/landscape preferences for matching dimensions. The control window is not always-on-top and may appear in whole-screen capture.

### Frozen tab recordings

Open WeScreen from the playing video tab, select Original video tab (compatibility capture), then grant the optional tabCapture permission on Start. This bypasses the sharing picker while preserving MP4 H.264/AAC output and local audio playback. Native API tests verify changing decoded frames from a real playing video tab. Device-specific Telegram freezes still require user verification.

## Safe upgrades / 升级保留录像

Normal updates retain the `wescreen` IndexedDB database under the same extension ID. The schema migration only adds missing stores; it does not delete or rebuild existing stores. Release versions and database schema versions are separate.

- Edge Store: update the existing listing. Do not uninstall before updating or switch to a different extension listing.
- Unpacked: close recording/processing pages after saving the active recording, extract new extension files over the existing extension directory, then Reload that existing entry in `edge://extensions`. Keep the same browser profile, extension entry and directory. Do not Remove it and load another folder.
- Switching between store and unpacked builds can change the extension ID and does not transfer the library automatically. Download recordings before switching.
- Clearing browser/extension data or uninstalling can remove browser-local recordings. Separately exported MP4 files are not deleted by updating the extension.
- Helper updates should also replace files in the existing helper directory, preserving `.runtime` and `models`.

Upgrade verification: `NODE_PATH=... node scripts/test-upgrade.cjs` uses an isolated Chromium profile, verifies legacy schema 3→4 migration, updates 1.13.0 to the current package in the same directory, and compares video bytes/SHA-256, metadata, recovery chunks, tasks, playback state and preferences. It does not access the user's browser data.
