<p align="center">
  <img src="assets/logo.png" alt="WeScreen" width="96">
</p>

# WeScreen Privacy Policy

**Last updated: 2026-09-27**

WeScreen is a screen recorder for Microsoft Edge that is designed so that your recordings never
leave your device. This policy explains exactly what the extension does and does not do with your
data.

## Summary

WeScreen does not collect, transmit, sell, or share any user data. There is no WeScreen server,
no account system, and no analytics. Everything the extension does happens locally in your browser.

## What WeScreen handles, and where it stays

| Data | Why it is handled | Where it goes |
| --- | --- | --- |
| Screen, window, or tab video and audio you choose to share | To record what you asked it to record | Kept in your browser's memory and written to your own device. Never uploaded. |
| Microphone audio, if you enable it | To mix narration into the recording | Mixed locally in the browser. Never uploaded. |
| Recording chunks | Written every second so an interrupted recording can be recovered | Stored in your browser's local IndexedDB on your device, and deleted once you discard the recording |
| Your preferences (file name, resolution, frame rate, quality, countdown, language, audio toggles) | To remember your settings between sessions | Stored in `chrome.storage.local` on your device |
| The finished recording | To give you the file | Saved to your Downloads folder by the browser's own download mechanism |

WeScreen has no ability to read your screen unless you pick a source in the browser's sharing
picker. It cannot see anything you did not explicitly choose to share.

## Network activity

WeScreen makes **no network requests**. It contains no analytics, no telemetry, no advertising, no
crash reporting, and no remotely hosted code. The extension works fully offline.

You can verify this: the extension requests only the `storage` and `downloads` permissions, and
its source is publicly readable at
<https://github.com/susunola/wescreen>.

## Permissions and why they are needed

| Permission | Purpose |
| --- | --- |
| `storage` | Save your preferences and the local recording chunks used for crash recovery |
| `downloads` | Save the finished WebM file to your device |

WeScreen requests no host permissions and no access to your browsing history, tabs, bookmarks, or
any website content.

## Data retention and deletion

- Recording chunks in IndexedDB are deleted when you discard a recording, and are overwritten on
  your next recording.
- Preferences in `chrome.storage.local` are removed when you uninstall the extension.
- Downloaded recordings are ordinary files on your device; deleting them is up to you.
- Because WeScreen never receives your data, there is nothing for us to delete on a server.

## Children

WeScreen is a general-purpose utility and is not directed at children. It collects no personal
information from anyone.

## Changes to this policy

If this policy changes, the updated version will be published at this URL with a new "last
updated" date.

## Contact

Questions about this policy can be raised at
<https://github.com/susunola/wescreen/issues>.
