# 本机视频增强

1.16 新增连续录像合并和声音修复。相同编码参数的分段直接复制合并；选择兼容合并后，不同参数可重编码成统一尺寸和帧率。两种方式都不修改浏览器里的原分段。声音另存复制原画面编码流；响度均衡采用两遍分析，音频重新编码为 AAC。

macOS 已装好依赖后，双击 `install-launcher.command` 注册本机启动器。之后扩展内“启动本机增强包”可通过 `wescreen-helper://start` 启动，旧程序无运行中任务时可更新。安装器保留模型与 `.runtime`，不会删除录像。运行中任务会阻止更新，需要完成后再启动新版。

合并上传受本机鉴权、输入格式、随机文件标识、单段 1.6 GB 上限和空间检查约束。闲置超过 24 小时的上传暂存文件在下次上传时清理；任务结束清理内部输入副本，完整结果保留至用户删除任务。录像库原文件不受影响。

默认提供两个修复档位，另保留轻量增强选项：

- 自然修复：FFmpeg 弱去块、时域降噪、适度锐化，保留原分辨率。这是传统滤镜处理，并非 RealBasicVSR 神经网络多帧超分辨率。
- AI 强力修复：SeedVR2 3B FP16 视频扩散模型，批次重叠。输入与输出短边最多 1080、长边最多 1920；不是一律放大 2×。建议先生成本档位预览并检查效果，再处理整段。
- 明暗增强：在降噪基础上调整亮度、对比度、gamma。输出为 SDR，不是 HDR 生成。
- AI 2× 超分辨率：OpenCV DNN 执行 FSRCNN 预训练神经网络，逐帧推理；不是普通插值。输入最高 1080p，输出最高 4K。轻量模型不等于现代大型修复模型，效果依赖素材。

## 启动

需要 FFmpeg/ffprobe 和 Python 3.10–3.13（当前依赖固定版本不支持 Python 3.14）。在仓库根目录运行：

```sh
bash enhancement/start.sh
```

首次启动会安装 OpenCV 和 NumPy；轻量 FSRCNN 模型已经包含在源码中；强力 SeedVR2 模型需单独安装，不会在处理时下载。启动后扩展自动连接，不用打开 token.txt。首次连接绑定该扩展来源，网页无法通过自动连接获取密钥；手动连接保留在高级设置中。密钥只存在本机和浏览器临时 session，不上传外部服务。

从录像库点击“画质增强”，选择模式，从当前播放位置选择 3／5／10 秒预览并同步对比，再点击“增强整段并另存”。原视频保留，结果为 H.264 + AAC MP4，并尽量保留音频。可取消处理中任务。

剪辑支持顺时针/逆时针 90°、0–360° 任意角度及 1920×1080 横屏画布；裁剪后旋转，斜角空白填黑，保持 H.264 + AAC 音轨。

裁剪与剪头尾从录像的“更多”菜单打开，支持画面拖选、像素坐标及当前播放帧设置起止，另存 MP4。

程序只监听 `127.0.0.1:8765`，只允许持有密钥的请求。每次只处理一个任务。完整结果与任务记录保存在 `enhancement/.runtime/jobs`，重启后仍保留，直到在处理任务面板中主动删除；无固定数量上限，磁盘不足时拒绝新任务而不删除旧结果。输入和中间文件在任务结束后清理，成功取回的预览删除。浏览器重开可以重新连接任务，完整结果可重试写库或通过短期授权 URL 直接流式下载，URL 不含长期连接密钥。程序会预估磁盘需求并检测处理期间的低空间；中断后重启的任务标记为失败，需要从原片重做。

输入限于 MP4/WebM、最高 4K/120 fps、1.6 GB；轻量 AI 输入上限 1080p。超限视频请先分段。VFR 输入在 AI 模式中转为固定帧率。强力模式最高输入/输出 1920×1080（竖屏为 1080×1920）；更大的源视频请用自然修复，避免降低分辨率。HDR 输入暂不支持，避免错误地将色彩映射为 SDR。

AI 无法准确恢复已经丢失的文字、身份细节或纹理，可能出现伪细节。请对比检查，增强视频不适合作为忠实还原的证据。

## 安装 AI 强力修复

先完成基础程序安装，再运行 `bash enhancement/install-seedvr.sh`。安装器下载独立 Python 运行环境依赖和约 7 GB 模型，验证 SHA-256。模型存储在 `enhancement/.runtime/seedvr-models`，不提交到 Git，也不上传视频。处理时使用离线模型。

使用维护版 [ComfyUI-SeedVR2 的独立 CLI](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler)，固定源码提交 `4490bd1f482e026674543386bb2a4d176da245b9`，无需运行 ComfyUI 页面。支持 Apple Silicon MPS / NVIDIA CUDA。采用 5 帧批次、25 帧流式块和 VAE 分块以控制内存。大型模型速度明显慢于轻量增强，重建阶段不显示虚构的百分比。

未安装时强力模式会明确提示安装，绝不退回 FSRCNN 后伪装为 SeedVR2。模型可能改变字幕、人脸及纹理；优先在真实素材上预览。

## 验证

```sh
enhancement/.venv/bin/python -m unittest discover -s tests -p '*_test.py'
WESCREEN_ENHANCE_TEST=1 node --test tests/library.browser.test.js
WESCREEN_ENHANCE_TEST=1 WESCREEN_STRONG_TEST=1 node --test tests/library.browser.test.js
WESCREEN_SEEDVR_TEST=1 enhancement/.venv/bin/python -m unittest discover -s tests -p '*_test.py'
```

浏览器测试需要 Playwright/Chromium，并提前启动本机辅助程序。
测试使用合成视频验证推理、音视频编码、播放及保存链路，不代表 Telegram 素材的修复效果基准。

## 模型来源

FSRCNN x2，来自 https://github.com/Saafke/FSRCNN_Tensorflow ，Apache 2.0，许可见 `models/LICENSE-FSRCNN.txt`。
模型 SHA-256：`366b33f0084c7b3f2bf6724f0a2c77bca94fcec9d7b6d72389d330073b380d5c`。推理前验证该摘要。

OpenCV 说明：https://docs.opencv.org/5.0/extra_modules/dnn_superres.html

## 新旧扩展连接（1.17）

先覆盖增强包并保留 `.runtime`、`.venv`、`models`，再运行 `install-launcher.command` 更新启动器。扩展点击“自动连接”时，如果当前 ID 尚未获准，启动器会在 Mac 本地显示 ID 和允许/取消按钮。允许后新旧 ID 均可连接，无需删除旧配对。许可为短期、一次性的原生授权；网页不能自行领取许可。后台重连不会弹出本机授权窗口。

`reset-connection.command` 仅保留为手动故障恢复入口，清除配对不会删除录像、结果或模型。通常不再需要使用它。

## 安全自动收尾与局部填补（1.17）

录制高级设置默认打开超过一分钟的静止尾段检查，并同时要求无声；视频保存后排队，原文件可以继续播放。本机离线时等待重连，忙时等待空闲。分段相同编码参数先保真合并再检查；参数不同会保留原片并提示显式兼容合并。仅移除持续到视频末尾、超过 60 秒的满足条件片段，保留最后有效画面约一秒。声音仍在、内部静止后有运动或整条录像静止时不裁剪。它是保守的画面/声音检测，不是对剧情或源播放器结束状态的理解。

播放器“更多 → 专业播放工具”提供固定水印的手动区域填补：圈选画面内部区域，预览 5 秒，检查后另存当前文件。修改选区需重新预览；移动水印和边缘水印不适合此滤镜，边缘可改用裁剪。当前分段的局部填补不会自动处理其他分段。结果和原片均保留，不自动下载。

## 实时 AI 播放增强

扩展画质菜单中的“智能最佳”使用本机 FSRCNN 2×，并在推理前做轻度空间降噪。帧只在内存处理，不保存到磁盘，也不上传到云端。音频和播放时钟保持原视频。

实时模式根据端到端耗时降低输入尺寸（长边 960 至 320，短边不超过 540），输出为输入的 2×。低负载档可能低于原视频分辨率，这个模式不能承诺达到原生 4K 或恢复丢失细节。处理尺寸和有效帧率显示在画质菜单中。过期帧会丢弃；持续跟不上或后台任务占用本机程序时恢复原画。最高质量另存请使用后台 AI 高清修复或 SeedVR2。

2026-10-03 本机 M4 Pro、48 GB，FSRCNN 2× 纯推理（三次平均，不含传输与显示）：320×180 约 10 ms，640×360 约 32 ms，960×540 约 70 ms。实际播放速度以菜单显示为准。

## Quality preservation (1.18)

Picture-only jobs copy compatible AAC, ALAC and MP3 audio instead of encoding it again. Other audio is converted to AAC at 256 kbps for MP4 compatibility. SDR color tags are propagated. Explicit HDR conversion is limited to Natural/Brightness/Edit modes and outputs BT.709 SDR; install `ffmpeg-full` on Mac for zscale support. The server prefers its keg binary when present, without replacing the system FFmpeg.

`/health` reports `toneMap` and `realtimeLossless`. Realtime frame requests accept bounded PNG or JPEG; PNG requests receive PNG output. Original media and saved tasks are preserved during upgrades.

## Experimental local face restoration

Run `bash enhancement/install-face.sh` after the basic helper setup (Python 3.11–3.12). The optional CodeFormer runtime is isolated in `.runtime/face-venv`; its source is pinned and its approximately 545 MB of weights are validated before `/health` advertises `face`. It selects MPS on supported Mac hardware, CUDA on supported NVIDIA systems, otherwise CPU. Source resolution, background and compatible source audio are retained; decoded frames stream through one model instance per job.

Use Player settings → Tools → Face restoration. Preview a 3, 5 or 10 second segment, compare faces and motion, then explicitly confirm full processing with unchanged settings. The helper requires a successful matching preview and identical source bytes. Preview receipts remain in Processing tasks until explicitly deleted. Outputs use `face-generated` in their names and are saved separately. Heavy masking can cause detection failure; the job then reports failure instead of claiming successful recovery. This is generative single-frame restoration, not recovery of authenticated facial identity, reference-frame reconstruction or ProPainter video inpainting.

CodeFormer has the [S-Lab non-commercial license](https://github.com/sczhou/CodeFormer/blob/master/LICENSE). Commercial use requires separate permission. We do not bundle its source or weights in the helper ZIP; the optional installer downloads them from the official repository/releases.


## Low-quality Smart best

Start the helper, then run `install-smart.command` (macOS) or `bash install-smart.sh`. The installer creates an isolated environment, downloads about 10 MB of official Real-ESRGAN weights, checks pinned SHA-256 digests and runs actual inference before advertising readiness. On Apple Silicon it uses PyTorch MPS/Metal; there is no claimed Core ML or temporal neural model. Model architecture license: `models/LICENSE-Real-ESRGAN.txt`.

The browser uploads the current file to an authenticated loopback session. Four-second chunks are repaired ahead of playback. The original supplies audio and the transport clock. A repaired chunk appears only after it is decoded and synchronized. Slow work never pauses the source. Session video blobs are capped at 128 MiB / six chunks in the browser; helper output is capped at 256 MiB / six chunks (plus at most one pending chunk). Sources are capped at 1.6 GB each, two sessions. Quit/toggle/source changes delete the session; abandoned sessions expire after ten minutes. Cache directories are removed on helper startup. These are temporary viewing caches, not permanent enhanced exports. Library recordings and original bytes are unchanged.

Explicit desktop text bypasses neural and temporal generation. Low-resolution containers can get 2x output; larger soft recordings are repaired at their native resolution using a bounded low-frequency neural guide residual; native pixels and strong edges remain the base. Analysis reports softness/noise/codec-grid indicators, not an asserted original pixel resolution. HDR keeps native playback; SDR is not labeled HDR. GPU performance varies with resolution: heavy models are background restoration, not guaranteed real-time.
