# WeScreen 1.6.1 submission artifacts

Build from the repository root: `python3 scripts/build-package.py`.

- Extension: `store/wescreen-1.6.1.zip`.
- Optional processing helper: `store/wescreen-helper-1.6.1.zip` (not part of the extension upload).
- Current listing: `store/listing.md`.
- Current privacy sources: `PRIVACY.md`, `PRIVACY.zh-CN.md`, `docs/index.html`.
- Six current 1280×800 screenshots are produced by `scripts/capture-product.cjs` with Playwright/Chromium. These use synthetic demonstration video.

The historical 1.1.0 zip is kept for reference; do not upload it for this version. The current package explicitly includes local helper guide and frontend modules, and excludes tokens, runtime environments, large model weights, jobs, tests and .git.

Before submitting, load the built zip in Chrome/Edge, check shared audio for each supported platform, review permissions, and publish the updated privacy document to the declared public URL. Neither a store submission nor privacy-page deployment is performed by the package builder. Cross-platform long recording and true-source restoration quality still require manual acceptance testing.
