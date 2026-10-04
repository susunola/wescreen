# Smart best playback cache

Smart best prioritizes the current playback position, then repairs all remaining
chunks of the current source file while its playback session stays open. Smart best plays completed restored segments and buffers at an unfinished
segment rather than falling back to original frames. Playback resumes when the
required segment is ready. Failed
startup retains Original rather than silently enabling lightweight enhancement.
Original and hold-to-compare remain explicit choices. Pausing
does not stop background coverage. Exiting, locking, or choosing Original stops
the worker and clears displayed media; completed repairs remain reusable locally.
A multipart recording has separate coverage for each physical source file.

The helper hashes the complete source bytes together with restoration policy,
model availability, and text-protection mode. New sessions recover completed
chunks from atomic metadata, including after helper restart. Browser memory holds
only nearby chunks (six / 128 MiB), independently of disk coverage. Replaying still
uploads the source over loopback to verify identity, but does not repeat completed
model inference.

The private helper cache retains about 8 GiB of completed repairs, evicts inactive
assets by least recent use, and expires assets after 30 idle days. An active asset
is not evicted; new work stops at the disk limit (one in-flight chunk may exceed
it by at most 256 MiB). Originals are never changed. Cache access requires helper
authentication and opaque session IDs. The optional UI password is an interface
lock, not encryption of recordings or cached repairs.

Bump `POLICY` in `enhancement/smart_cache.py` whenever model settings or restoration
math change, to invalidate incompatible results.
