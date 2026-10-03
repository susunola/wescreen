# WeScreen

[English](README.md) · Chrome / Microsoft Edge 本地录屏与视频管理工具。

## 安装

在浏览器扩展的开发者页面加载此目录，或解压 `store/wescreen-1.6.1.zip` 后加载。点击 WeScreen 打开录制页面。改动代码后需重新加载扩展；数据库升级前请关闭旧录制页面。

## 使用

- Telegram 频道档案可保存频道链接、独立编号、待录消息清单和下载子文件夹；录制完成后推进到下一条，录像可按频道筛选并回到原消息。浏览器共享选择器仍需手动确认，不会后台抓取频道。
- 选择屏幕、窗口或标签页录制。MP4 需浏览器支持 H.264 + AAC；也可选 WebM。共享声音由浏览器选择器控制。
- 录像库支持播放、搜索、排序、课程信息、导入、下载路径、批量选择、回收站和永久删除。永久删除浏览器录像不会删除导出的磁盘文件。
- 使用扩展 IndexedDB、unlimitedStorage 和持久存储请求，没有固定 10 GB 总量限制，容量受磁盘空间约束。长录制在约 800 MB 自动分段以控制内存，单段约 1.6 GB 是保护阈值，不是录像库总量限制。新段先开始、旧段再停止，边界可能存在极短重叠。
- 摄像头画中画在工作线程处理视频帧，不依赖页面动画。不支持相应接口的浏览器会明确提示，关闭摄像头仍可直接录屏。
- Telegram 模式：先暂停视频，选择 Telegram 标签页并勾选共享声音，倒计时结束后播放。桌面窗口声音取决于系统；可用裁剪与剪头尾保留播放器区域并去掉等待时间。

## 1.6 新增

- 频道工作台：待录、完成、跳过、选择重录、顺序调整与重复消息检查。
- 录制监测：预览帧率/丢帧、最近写入、待写片段、长时间无音频提示。预览统计不是编码器掉帧统计。
- 多选录像加入持久队列，顺序增强；暂停在当前任务完成后生效，重开页面可继续，失败项支持重试。批量强力修复暂不开放，需要逐片预览确认。
- 剪辑支持左右 90° 与任意角度旋转，另可输出 1920×1080 横屏画布；先裁剪后旋转，保留音轨与原片。
- 当前帧黑边建议、频道裁剪记忆与同步局部放大对比。
- 支持导入 token.txt 自动检测连接；macOS 已有 Homebrew 时，启动脚本可安装缺少的 FFmpeg/Python。未装 Homebrew 的电脑仍需安装依赖。

## 剪辑与增强

使用仓库或独立辅助程序包，安装 Python 3.10–3.13 和 FFmpeg，再运行 `bash enhancement/start.sh`；macOS 可双击 `enhancement/start.command`。将 `enhancement/.runtime/token.txt` 的密钥填入连接面板，检测程序与模型状态。

默认自然修复；FSRCNN 提供轻量 2× 放大；SeedVR2 强力修复需另运行 `bash enhancement/install-seedvr.sh`（模型约 7 GB）。支持选择 5 秒片段预览、同步播放/定位/暂停及原尺寸查看。强力模式必须先预览。AI 可能生成错误细节，无法保证恢复到原本清晰度；输出为 SDR，明暗增强不是 HDR。

裁剪与剪头尾另存 MP4，原版保留。完整结果和任务存于 `enhancement/.runtime/jobs`，明确删除前一直保留，重启辅助程序后仍可取回。重新打开页面可查看任务、重试存入录像库或直接流式导出文件；处理中断后需从原片重做。每次处理一个任务，完成结果无固定数量上限，受磁盘空间约束。视频不上传外部处理服务。首次安装依赖与模型需要联网。详见 [辅助程序说明](enhancement/README.md) 与 [隐私政策](PRIVACY.zh-CN.md)。

## 测试与打包

```sh
node --test tests/*.test.js
enhancement/.venv/bin/python -m unittest discover -s tests -p '*_test.py'
WESCREEN_SEEDVR_TEST=1 enhancement/.venv/bin/python -m unittest discover -s tests -p '*_test.py'
python3 scripts/build-package.py
```

浏览器测试需 Playwright 和 Chromium，未安装时跳过。覆盖跨页面恢复、慢存储分段、工作线程画中画、实际编码播放、回收站、配额失败及结果保留。合成视频用于验证处理流程，不代表真实 Telegram 画质基准。正式发布前需另验长录音画同步及系统/浏览器兼容性。
