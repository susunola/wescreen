# Changelog

## 1.9.1

- 录制完成与录像库播放支持左右旋转、任意角度和旋转全屏，自动适应画面；播放旋转无需本机处理程序，不修改原文件。

## 1.9.0

- 强力 AI 支持直接增强整段，预览改为推荐操作。
- 新增静音录制：原视频标签页直采保存声音，不向扬声器播放；临时解除网页播放器静音，停止后恢复音量和静音状态。

## 1.8.13

- 自动连接显示进行中反馈，旧扩展配对冲突提供明确恢复步骤。
- 本机增强包提供重置配对工具，保留录像、结果和模型。

## 1.8.12

- 录制清单弹窗的保存与关闭按钮增加 16px 间距，窄屏自动换行。

## 1.8.11

- 顶部 GitHub 下载按钮加入 GitHub Logo，与文字居中对齐。

## 1.8.10

- 移除工具栏弹窗底部的 GitHub 下载链接，简化弹窗。

## 1.8.9

- 关于页与其他功能区同宽，减少左右留白。

## 1.8.8

- 五个 Tab 统一为同尺寸、同线宽的 SVG 图标，与文字居中对齐。
- Telegram Tab 使用单色纸飞机，频道标题与场景按钮保留彩色 Logo。

## 1.8.7

- 在五个 Tab 下方增加细分隔线和间距，区分导航与功能区。

## 1.8.6

- 按确认效果图重做录制页：场景切换、画质格式、音视频开关、折叠设置和三步引导。
- Telegram 页采用频道设置与录制清单双栏布局，提供清单弹窗、单条菜单和移除已完成项。
- 关于改为第五个同级 Tab，使用用户提供的 Telegram Logo。
- 防止并发刷新导致频道清单重复，清空已完成项保留已有录像。

## 1.8.5

- 按确认效果图重做录像库：紧凑筛选与批量操作、缩略图播放、原版与增强版分组、右侧统一操作。
- 增加关于页：作者 atomoswang、实际安装版本、GitHub 增强包下载和可选 SeedVR2 安装说明。
- 保留导入、播放、增强、导出、重命名、回收站和分页功能，支持中英文及窄屏。

## 1.8.4

- 按设计图重做视频处理页：右上角集中连接状态和刷新，已连接时隐藏连接按钮。
- 新增空任务引导，直接进入录像库选择视频；任务改为紧凑卡片。
- 自动连接和断线状态明确显示，支持中英文及窄屏。

## 1.8.3

- 录完后顶部提供录制下一条和录像库入口。
- 点击录制菜单返回设置页，停止旧预览播放；保留已存录像和录制设置。

## 1.8.2

- 修复 FFmpeg 初始进度为 N/A 时导致自然修复、明暗增强和视频编辑失败的问题。
- 忽略无效时间并保证进度不倒退；本机处理程序需同步更新。

## 1.8.1

- 在录制页和扩展弹窗加入 GitHub 最新扩展包下载入口。
- 移除录制页课程录制入口，升级时停用旧课程自动命名；既有课程录像仍可查看。
- 验证中英文窄屏、安装包、标签页运动画面与自动连接。

## 1.8.0 — 2026-10-03

- Simplify Telegram recording to channel selection, name and optional video title; fold links, numbering, export folders and recording lists into optional settings.
- Align the library bulk toolbar, add spacing to expanded controls, widen the recording panel and simplify navigation/filter menus.
- Automatically connect to the local helper and reconnect on reload; first connection pins a browser-extension origin and web origins cannot obtain credentials. Keep manual connection under Advanced settings.
- Select 3, 5 or 10 preview seconds from the current playback position. Fold detailed comparison controls and explain disabled models/buttons.

## 1.7.1 — 2026-10-03

- Add optional original-tab capture as an explicit compatibility alternative for recordings with frozen video. Request tabCapture only on selection and preserve local audio playback.
- Verify decoded MP4 frames actually change while recording in the background; add a native tabCapture test with a playing video source.

## 1.7.0 — 2026-10-03

- Add Telegram source preflight with a picture/audio meter and a separate recording control window.
- Save each channel video separately while retaining the shared source; pause between videos and copy the next message link for the original shared tab.
- Add start/middle/end recording review thumbnails and direct editing.
- Remember channel crop, rotation and landscape preferences for matching source dimensions.
- Suggest conservative leading/trailing black-screen trims for manual confirmation and warn before rerecording completed plan items.

## 1.6.1 — 2026-10-03

- Display the installed manifest version beside the name in the recorder and popup.

## 1.6.0 — 2026-10-03

- Shorten the English manifest description to meet the 132-character store limit and validate every locale before packaging.

- Add clockwise/counterclockwise portrait rotation, arbitrary 0–360° angles and an optional 1920×1080 landscape canvas, preserving audio and the original video.
- Add recording write/audio warnings and preview frame diagnostics.
- Add a channel workbench with reorder, skip and rerecord actions, duplicate message detection and remembered crop regions.
- Add a persisted sequential enhancement queue with pause, resume and retry.
- Add synchronized detail zoom, suggested black-border cropping and token-file import.
- Check/install missing FFmpeg/Python through an existing Homebrew installation; include all SeedVR2 installer dependencies in helper packages.

## 1.5.0 — 2026-10-03

- Prevent stale recovery from overwriting completed recordings; reread state under the recording lock and archive with non-overwriting keys.
- Rotate encoders before stopping the previous segment; automatically segment near 800 MB to bound memory, with a possible small overlap.
- Compose camera picture-in-picture in a frame-processing worker, with explicit capability/error handling.
- Separate Record, Library and Processing tasks; add import, sorting, bulk selection, Trash and restoration.
- Use recording records for course views; keep rename/deletion consistent.
- Retain full processing results across page/helper restarts; support save retries and authenticated streaming export.
- Add crop/trim, selected-range enhancement previews and synchronized comparison.
- Preserve channel selection and the next planned video on reload; retain invalid plan drafts and show library errors in the active view; distinguish offline helpers from missing tasks.
- Add Telegram channel profiles, per-channel numbering, message recording plans, channel library filters and export subfolders.
- Add unlimitedStorage and persistent-storage request; remove a fixed 10 GB total-library assumption.
- Update languages, privacy, listing, packaging and regression scenarios.



## 1.1.0

P0 收尾：把 1.0 里"看起来有、实际没有"的能力补齐，并让录制过程的资源占用可见。

## 分辨率、帧率与画质各司其职

1.0 的"720p / 1080p"只切换码率，从不改变输出分辨率——UI 写着 720p，录出来还是源分辨率。

- 新增独立的分辨率选择（原始分辨率 / 1080p / 720p）与帧率选择（30 / 60 fps），画质选择只负责码率。
- 分辨率上限通过 `applyConstraints` 应用到采集轨道上；约束被拒绝时只损失分辨率上限，不会丢失录像。
- 录制开始后会告知实际输出尺寸：`已按 1280×720 缩放输出` 或 `源分辨率 1280×720 未超过所选上限，保持原始画面`。
- 1.0 的设置会自动迁移：旧设置里的 `compact` 画质对应 720p 上限，其余对应 1080p。

## 内存与磁盘占用不再是一句空话

1.0 的录制界面写死"本地分段保护已开启"，那只说明分片落了盘，不代表内存安全——停止时仍要把整段录像在标签页堆里拼装成一个 Blob。

- 录制中实时显示已录制体积与本次软上限：`已录制约 240 KB（本次上限约 1.6 GB）`。
- 达到 800 MB 变黄提示尽快停止下载，达到 1.6 GB 变红提示立即停止以保住录像。
- 设置页显示本机可用存储；低于 500 MB 时提示先清理磁盘再录长视频。
- 录制中关闭标签页会先弹出确认，避免误关丢掉正在录的内容。
- 已知限制已写入 README，不再暗示长录制没有内存风险。

## 麦克风与音频降级

1.0 里 `getUserMedia` 没有独立的错误处理：麦克风被拒绝会直接让整场录制失败，屏幕录制根本不会开始。

- 麦克风授权失败不再中断录制，画面与系统音频继续；共享源没有音频时同样继续。
- 降级状态在录制界面明确提示（`麦克风不可用，已继续录制画面与系统声音。`），不再静默出一个没声音的文件。
- 停止录制时释放麦克风轨道并关闭混音用的 `AudioContext`。

## 中英文界面

1.0 的"中文 / EN"按钮没有绑定任何事件，点了没有反应。

- 补齐中英文界面，右上角按钮可切换并记住选择。
- 扩展名称、描述与快捷键说明通过 `_locales`（`zh_CN` / `en`）本地化，跟随浏览器语言。
- 切换语言会同步刷新定时器旁的占用提示、按钮状态与提示文案。

## 隐私说明前置

- 录制器与弹窗顶部明确写出"无账号 · 无上传 · 无追踪"，README 新增隐私章节，说明只申请 `storage` 与 `downloads` 两项权限及各自用途。

## 图标与文档

- 补齐扩展图标（16/32/48/128），此前 manifest 未声明 `icons` 与 `action.default_icon`，商店与工具栏只能显示默认占位图。
- README 拆分为英文（默认）与中文两份并互相链接，顶部加入 logo、定位说明与隐私要点。
- CHANGELOG 记录 1.0 遗留问题与本次修复的对应关系。

## 商店上架准备

- `default_locale` 由 `zh_CN` 改为 `en`：英文用户此前会拿到中文描述，而上架时英文是覆盖面最广的默认语言。`_locales` 同时提供 `en` 与 `zh_CN`，Partner Center 据此列出两种语言。
- 新增 `PRIVACY.md` / `PRIVACY.zh-CN.md` 与 `docs/index.html`（自包含页面，供 GitHub Pages 用作隐私政策 URL）。
- 新增 `store/`：可直接上传的 zip、精确尺寸的商店素材（300×300 logo、440×280 与 1400×560 宣传图、6 张 1280×800 截图）、中英文商店文案、送审说明与逐步上架清单。
- 新增 `scripts/build-store-assets.py`，商店素材可从仓库现有图片一键重建，不再手工出图。
- 下载改走 `chrome.downloads`：此前 manifest 声明了 `downloads` 权限，代码却从未调用它，只用合成 `<a>` 点击保存文件——这正是审核判定"申请不必要权限"的典型情形。现在声明与实现一致，文件名交给浏览器下载管理器处理，保存失败会给用户明确提示，锚点点击仅作兜底保留。
- `store/listing.md` 新增 Privacy 页面四个必填框（单一用途、storage 理由、downloads 理由）的可粘贴文案，中英文各一份，并逐项核对 1000 字符上限。

## 其他修复

- IndexedDB 分片带会话前缀命名，停止录制不再立即清空分片，因此刷新页面后仍能恢复刚录完的内容。
- 恢复判定改用 `meta` 存储中的 `inProgress` 标志：正常停止后不再误报"未完成的录制"。
- 分片直接以 `Blob` 存入 IndexedDB，去掉一轮 base64 编码带来的额外内存拷贝。
- 设置读取失败、存储估算不可用、语言节点缺失等情况不再让页面卡在初始化。
