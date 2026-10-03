# WeScreen Privacy Policy

Last updated: 2026-10-03

## Local processing

WeScreen records selected screens, windows or tabs on your device. It has no account, cloud video storage, analytics, advertising or telemetry. Screen/audio capture starts only after you choose a source. Optional microphone, camera and click highlighting operate only when enabled.

## Data and storage

Completed recordings, imported videos, thumbnails, course metadata, markers, processing tasks and recovery chunks are stored in the extension's IndexedDB on this device. Preferences are in chrome.storage.local. The helper access token is stored in a local file and chrome.storage.session. Video is never sent to an external processing service.

## Network activity and installation

Recording and library functions work offline. Optional enhancement and crop/trim send the selected video to the authenticated helper at http://127.0.0.1:8765, on this same device. The helper uses local FFmpeg, FSRCNN and optionally installed SeedVR2. Initial dependency/model installation contacts package registries, GitHub and Hugging Face; it does not upload videos. User-initiated Telegram or other links open their respective websites.

## Permissions

- storage: save preferences, recorder ownership and temporary token.
- unlimitedStorage: allow the local video library to grow beyond normal origin quota and protect it from eviction. There is no fixed 10 GB library cap; physical disk capacity still applies.
- downloads: export MP4/WebM videos, results and learning notes; show the last export location.
- Optional tabCapture: only after you choose direct-tab compatibility capture and grant permission, capture the tab where you invoked WeScreen. Captured audio is also played locally so you can continue listening.
- activeTab and scripting: insert optional click highlights into the tab where you invoke the extension. This does not grant persistent access to all websites.
- http://127.0.0.1:8765/*: connect only to the local processing helper.

## Retention and deletion

Recovery chunks are deleted after a successful archive or explicit discard. Moving a recording to Trash keeps its local video until permanent deletion. Enhanced/edited versions are separate records. Permanently deleting a browser record does not remove an exported disk file. Clearing extension data or uninstalling removes the browser library; export backups first. Normal browser browsing-data clearing does not clear extension-origin storage.

Full processing results and task metadata are retained in enhancement/.runtime/jobs until you explicitly delete them from Processing tasks. They survive helper restarts. Interrupted work is marked failed after restart; rerun from the original video. Input/intermediate files are removed when a task ends; previews are deleted after successful retrieval. Completed exported files remain under your control.

## Contact and changes

Updated policies are published at the same URL with a revised date. Questions: https://github.com/susunola/wescreen/issues . WeScreen is a general utility and collects no personal data from children or adults.

Channel names, channel/message links, recording plans, numbering and relative export folders are stored locally with recording metadata. The application does not read Telegram accounts or automatically download channel content.

The local helper offers automatic connection only to browser-extension origins. The first extension origin is bound locally; ordinary web origins cannot obtain the connection credential. Manual connection remains available in Advanced settings. Preview duration can be selected as 3, 5 or 10 seconds.
