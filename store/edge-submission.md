# Edge 商店提交 · WeScreen 1.6.0

上传扩展文件：`wescreen-1.6.0.zip`（manifest.json 位于 ZIP 根目录）。
`wescreen-helper-1.6.0.zip` 是独立的本地增强程序，不能作为扩展包上传。

## 商店资料

- 名称：WeScreen
- 中英介绍：复制 `listing.md` 对应语言段落。
- 隐私政策：https://susunola.github.io/wescreen/
- 支持页面：https://github.com/susunola/wescreen/issues
- 网站：https://github.com/susunola/wescreen
- 截图：`screenshot-*.png`，当前六张，均为 1280×800 实际扩展界面（合成演示素材）。
- 图标：`logo-300.png`；宣传图：`tile-small-440x280.png` 与 `tile-large-1400x560.png`。

## 单一用途

在本机录制、管理、编辑与导出屏幕视频；可按频道整理视频，并使用用户另行安装的本地程序进行可选画质增强。

## 权限用途

- storage：保存语言、录制设置与当前频道选择。连接密钥存于临时 session。
- unlimitedStorage：保存用户录像和元数据，突破普通来源配额并降低驱逐风险；仍受磁盘空间约束。
- downloads：导出视频、学习标记和索引，记录实际下载路径，并打开所在文件夹。
- activeTab：读取用户主动操作标签页的名称／链接，并在用户启用时标记鼠标点击。
- scripting：仅按用户操作注入当前标签页的点击标记。
- http://127.0.0.1:8765/*：连接用户另行启动的本地增强服务，携带本机连接密钥；视频不发送至云端。

扩展没有远程执行代码、广告、分析服务或账号。可选本地程序安装依赖及模型时联网，但不上传视频。数据使用声明应与隐私政策及实际本地处理行为一致。

## 审核测试说明

1. 加载扩展，选择屏幕／窗口／标签页；需要声音时在浏览器选择器勾选共享音频。
2. 录制并停止，在录像库播放、下载、查看路径、移入回收站或恢复。
3. 频道工作台输入频道名称与消息清单；录制仍需用户确认浏览器共享，应用不会自动抓取频道。
4. 可选剪辑、旋转及增强需要另安装增强程序。macOS 可打开 enhancement/start.command；也可运行 bash enhancement/start.sh。需要 Python 3.10–3.13、FFmpeg；已有 Homebrew 时启动脚本可安装缺少依赖。
5. 从连接面板选择 enhancement/.runtime/token.txt，检测连接；再打开剪辑，测试左右旋转和横屏画布。
6. 强力 SeedVR2 是另选模型安装；未安装时会禁用对应模式。无需安装强力模型即可测试录屏、录像库、裁剪及自然修复。

代码与素材已准备，商店上传及提交由用户操作。尚未完成 Windows 真机和 90 分钟连续录制验收。

参考：https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
