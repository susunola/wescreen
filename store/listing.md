# WeScreen 1.6.1 — listing copy

## English

Record screens, windows or browser tabs to MP4 (H.264 + AAC, when supported) or WebM, without an account or cloud upload. Keep a searchable local library with thumbnails, course metadata, markers and last export paths. Sort, import videos, select multiple recordings, restore from Trash or delete permanently.

A channel workbench stores channel profiles and message plans, supports reorder/skip/rerecord, and exports into channel subfolders. A persisted batch queue processes selected videos sequentially with pause/resume/retry. Portrait videos can rotate left/right 90° or use a 1920×1080 landscape canvas while preserving audio.

A Telegram video preset selects source resolution, high quality, shared audio and a countdown. The browser's source picker determines what is captured; desktop audio depends on browser and operating system. Long recordings rotate encoders before stopping the previous segment and automatically rotate near the memory threshold. Tiny segment-boundary overlap is possible. Interrupted chunks can be recovered, subject to codec/container support.

Optional crop/trim and enhancement use a separately installed, token-authenticated local helper. Natural restoration reduces compression artifacts and noise while preserving resolution. FSRCNN offers lightweight 2× upscaling, and optional SeedVR2 provides stronger restoration after a preview. Selected-range previews and synchronized comparisons help judge results. Full results remain on this device for retrying a library save or direct MP4 export. AI cannot guarantee recovery of lost details; brightness processing is SDR, not HDR.

The browser library has no fixed 10 GB cap; disk space remains finite. Exported files and browser-library copies are separate. Back up before clearing extension data or uninstalling. Recorder/library functions work offline; the extension communicates with 127.0.0.1:8765 only for optional local processing. Installing dependencies/models requires internet access but does not upload videos.

## 中文

无需账号或上传云端，本地录制屏幕、窗口或标签页为 MP4（浏览器支持 H.264 + AAC 时）或 WebM。录像库支持缩略图、搜索、排序、课程与重点标记、导入视频、导出路径、批量选择、回收站还原及永久删除。

频道工作台支持频道档案、待录清单、排序、跳过、重录和频道子文件夹导出。多选视频可加入持久批量增强队列，支持暂停、继续与重试。竖版画面可左右旋转 90°，或保留直立方向置于 1920×1080 横屏画布，保留音轨。

Telegram 视频预设使用原始分辨率、高画质、共享声音和倒计时。录制范围由浏览器共享选择器决定；桌面声音取决于浏览器与系统。长录制在停止上一段前启动下一段，并在接近内存阈值时自动分段，边界可能存在极短重叠。意外中断后的分片可尝试恢复，实际可播放性取决于编码与容器。

可选裁剪/剪头尾及画质增强需要另装通过密钥连接的本机处理程序。自然修复去块、降噪并保留原分辨率；FSRCNN 提供轻量 2× 放大，SeedVR2 强力修复需先预览。支持选片段预览与同步对比；完整结果保留在本机，可重试存入录像库或直接导出 MP4。AI 无法保证还原丢失细节；明暗处理为 SDR，不是 HDR。

录像库无固定 10 GB 总量限制，但受磁盘空间约束。浏览器保存与导出文件为独立副本，清除扩展数据或卸载前请备份。录制和录像库可离线使用，可选处理仅连接 127.0.0.1:8765。首次安装依赖/模型需联网，不上传视频。

## Reviewer notes / 审核说明

Permissions: storage, unlimitedStorage, downloads, activeTab, scripting and host http://127.0.0.1:8765/*. No cloud processing, analytics or remotely hosted extension code. Optional helper is a separate local installation. Recordings are not sent to package/model distribution sites. Camera composition requires MediaStreamTrackProcessor/Generator and transferable streams; unsupported browsers display an error before recording.

Load the extension zip; choose a capture source and shared audio; record, stop and inspect Library. Optional editing/enhancement requires starting the separately supplied helper and entering its token. Review local helper behavior independently from extension loading. The local privacy page in docs/index.html is updated; publishing it requires deployment of the repository changes.

Optional tabCapture permission: requested only when the user selects original-tab compatibility capture, to record the tab from which WeScreen was invoked. No persistent access to all websites is requested.

1.8.0: Simplified Telegram recording, automatically paired local helper connection, 3/5/10-second previews from the current playback position, and clear explanations for unavailable AI models. Requires the updated local helper for automatic connection.
