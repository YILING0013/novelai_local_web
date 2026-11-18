# NovelAI Local Android

安卓本地版使用 Capacitor 8，在 APK 内运行工作台页面。它与开源桌面版共享 React 工作区和 Rust 业务代码，使用 AGPL-3.0 许可证。应用包名为 `cc.idlecloud.nai.local`，可以与已有的 NovelAI Mobile 并装。

## 使用

- 安装后可使用 NovelAI 官方 Persistent Token 或邮箱密码登录。订阅状态、Anlas 和 V5 额度来自官方账户。官方要求额外验证码时可使用 Persistent Token。
- 从登录页打开「本机工具」，可在离线时浏览图库、编辑图片，以及使用已经下载的本地推理模型。在线生成、官方标签补充、机器翻译及模型下载需要网络。
- 工作区沿用桌面版的绘画、局部重绘、漫画、参考图库、作品版本和元数据编辑。安卓本地推理使用 CPU。模型按需下载并校验。
- 手机侧栏集中切换绘画、重绘、漫画和图像处理。顶部更多菜单提供账户和设置，生成工具与参数入口位于画布底部。漫画和图像处理的绘图工具可从各自的工具栏打开。
- 原图、图库索引和模型存放在应用私有目录。图像、笔记、漫画及元数据副本通过 Android 文件选择器导出。批量元数据副本打包为 ZIP。卸载应用会移除应用私有数据，需保留的文件可提前导出。
- 官方访问凭据由 Android Keystore 加密，官方 HTTPS 请求使用 Rustls。持续生成时请保留应用进程。系统结束进程后，已保存的图片可从图库打开，未完成的批次需要手动检查后重新发起。

## 从源码构建

需要 Node.js 24、JDK 21、Rust、cargo-ndk、Android SDK Platform 36 和 NDK 28.2.13676358。目标设备为 Android API 24 及以上的 ARM64 手机或 x86_64 设备，需安装支持 Chromium 120 或更新版本的系统 WebView。构建时设置 `JAVA_HOME` 和 `ANDROID_HOME`。在本项目的 Windows 开发工作区可先加载上级目录的 `Enable-Android.ps1`。

```powershell
rustup target add aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk --locked
cd next_nai_web
npm.cmd ci
npm.cmd run build:android
```

Linux、macOS 将 `npm.cmd` 换成 `npm`。构建经 Gradle Wrapper 生成调试签名 APK，路径为 `android/app/build/outputs/apk/debug/app-debug.apk`。从仓库根目录可运行 `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`。正式分发需要配置自己的 Android 发布签名。

## 验证

共享前端运行 `npm test` 和 `npm run lint`。Android 集成测试和静态检查可通过 `npm run build:android -- :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug` 构建。在设备上安装主 APK 和测试 APK 后，可以执行下列命令运行集成测试。

```text
adb shell am instrument -w cc.idlecloud.nai.local.test/androidx.test.runner.AndroidJUnitRunner
```

在测试命令中加入 `-e loadModel true` 可验证公开 QuickSRNet 模型的下载及 CPU 加载流程。

在构建命令中加入 `-PnaiLayoutTest=true` 可以生成与验收包并装的测试应用。安装这组 APK 后，测试命令中的应用包名改为 `cc.idlecloud.nai.local.layouttest.test`。
