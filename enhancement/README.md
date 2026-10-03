# 本机视频增强

默认提供两个修复档位，另保留轻量增强选项：

- 自然修复：FFmpeg 弱去块、时域降噪、适度锐化，保留原分辨率。这是传统滤镜处理，并非 RealBasicVSR 神经网络多帧超分辨率。
- AI 强力修复：SeedVR2 3B FP16 视频扩散模型，批次重叠。输入与输出短边最多 1080、长边最多 1920；不是一律放大 2×。必须先生成本档位预览才能处理整段。
- 明暗增强：在降噪基础上调整亮度、对比度、gamma。输出为 SDR，不是 HDR 生成。
- AI 2× 超分辨率：OpenCV DNN 执行 FSRCNN 预训练神经网络，逐帧推理；不是普通插值。输入最高 1080p，输出最高 4K。轻量模型不等于现代大型修复模型，效果依赖素材。

## 启动

需要 FFmpeg/ffprobe 和 Python 3.10–3.13（当前依赖固定版本不支持 Python 3.14）。在仓库根目录运行：

```sh
bash enhancement/start.sh
```

首次启动会安装 OpenCV 和 NumPy；轻量 FSRCNN 模型已经包含在源码中；强力 SeedVR2 模型需单独安装，不会在处理时下载。启动后打开 `enhancement/.runtime/token.txt`，将内容复制到扩展“画质增强 → 连接本机增强程序 → 连接密钥”。密钥只存在本机和浏览器临时 session，不上传外部服务。

从录像库点击“画质增强”，选择模式，先选择起点预览 5 秒并同步对比，再点击“增强整段并另存”。原视频保留，结果为 H.264 + AAC MP4，并尽量保留音频。可取消处理中任务。

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
