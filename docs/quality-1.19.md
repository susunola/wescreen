# WeScreen 1.19.0 采集与编码验证

## 已实现

原生像素为尽力请求，不保证 OS 或浏览器交付物理像素。共享尺寸使用 ideal，成功后请求轨道 capability 最大尺寸及 resizeMode:none；不支持时仅请求尺寸，再失败则保留采集。能力比实际尺寸接近两倍时显示非原生提醒。窗口/跨显示器尺寸无法用当前 screen/DPR 判断，因此不作虚假的原生保证。

码率公式：场景基准 × max(0.5, 像素比^0.75) × (fps/30)^0.585，最高 180 Mbps。文字 standard/compact 为 18 Mbps 基准、high 为 24；运动 compact/standard/high 为 5/10/14。文字 compact 在界面禁用，计算也保护旧设置。低清源不补造像素。Native 为新设置默认，不覆盖已有有效设置。

母带是 x264 CRF16 slow animation yuv444p；不是从已损失的 4:2:0 中恢复色度。兼容输出 CRF18 fast yuv420p。母带扩展名包含 444-master，可能无法在浏览器解码，适合本机专业播放器。当前 Mac VideoToolbox 编码器没有经验证的 4:4:4 HEVC 输出，因此不提供该选项。兼容合并仍优先流复制；SeedVR2 输入准备仍 CRF0。

## 实时路线

视频元素继续管理音频与时钟，canvas 仅覆盖画面。新 helper 采用 application/x-wescreen-rgb，width/height 明确传输，输入长度严格验证，无 PNG 编解码；输出原尺寸 RGB，长边封顶 1080。处理期间不排队，延迟加大后进一步隔帧，绝不动态降低分辨率。定位、切源和关闭使过期请求失效。

Mac 当前为常驻 OpenCV FSRCNN 回退模型，内部 2×结果还原至输入尺寸，不宣称为因果模型。Canny 高边缘区域采用弱双边滤波保守保护，属于非语义检测，也会保护部分物体轮廓。整个文字场景默认使用轻量观看调节，不启动 FSRCNN。没有实现 SwiftVR CoreML / TensorRT 转换；这需要经过验证的模型、权重和真实 GPU 测量。

## 验证

JS 测试验证原生约束、文字/运动码率、录制和数据库行为。Python 使用真实 FFmpeg 验证 444/420 格式、音轨和源文件保留，并用真实 FSRCNN 检查 RGB 长度、尺寸、认证、并发和上限。浏览器测试用合成视频验证 RGB 处理、跨段、seek、旋转、全屏、延迟隔帧和导航清理。升级测试从 1.13.0 到 1.19.0，原 ID 下保留视频字节/哈希、恢复片段、任务与偏好。

实际 Mac/Windows 显示共享物理像素和长时间高分辨率录制仍需要真实设备测试；不以 headless 合成采集结果代替系统采集验证。

参考：[W3C Screen Capture](https://www.w3.org/TR/screen-capture/)、[SwiftVR 官方实现](https://github.com/H-oliday/SwiftVR)。
