# NovelAI Local Android

安卓本地版使用 Capacitor 8，在 APK 内运行工作台页面。它与开源桌面版共享 React 工作区和 Rust 业务代码，使用 AGPL-3.0 许可证。应用包名为 `cc.idlecloud.nai.local`，可以与已有的 NovelAI Mobile 并装。

## 使用

- 从 [Android 0.1.3 发布页](https://github.com/YILING0013/novelai_local_web/releases/tag/android-v0.1.3) 下载签名 APK。旧调试包使用不同签名，安装首个正式版前可先从调试包导出图库原图与项目。
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

Linux、macOS 将 `npm.cmd` 换成 `npm`。构建经 Gradle Wrapper 生成调试签名 APK，路径为 `android/app/build/outputs/apk/debug/app-debug.apk`。从仓库根目录可运行 `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`。

## 应用更新与发布

正式版在启动、回到前台和应用运行期间按六小时的间隔查询开源仓库。右上角「应用更新」可手动检查。新版出现后，用户可在应用内下载，看到进度，再由 Android 系统确认安装。安装前校验 GitHub Release 资产的 SHA-256、包名、版本及已安装应用的签名。调试包通过发布页获取正式版。

正式打包设置 `NAI_LOCAL_ANDROID_KEYSTORE`、`NAI_LOCAL_ANDROID_STORE_PASSWORD`、`NAI_LOCAL_ANDROID_KEY_ALIAS` 和 `NAI_LOCAL_ANDROID_KEY_PASSWORD`，然后在 `next_nai_web` 运行 `npm run build:android -- :app:assembleRelease :app:lintRelease`。本机 Windows 开发工作区也可以从仓库根目录运行 `android/release.ps1`，读取工作区 `.tools/android-signing/novelai-local` 中受当前用户保护的发布签名。构建产物为 `android/app/build/outputs/apk/release/app-release.apk`。

后续发布沿用同一签名和包名，递增 `android/app/build.gradle` 中的 `versionName` 和 `versionCode`。从对应提交构建后，用 Android SDK 的 `apksigner verify --print-certs` 核对签名，把 APK 命名为 `NovelAI-Local-Android-<版本>.apk`。在此仓库创建 `android-v<版本>` Release，带上上述 APK，并保留桌面 Release 的最新标记。客户端从 GitHub 的正式 Android 标签和 APK 资产读取版本及摘要。

## 验证

共享前端运行 `npm test` 和 `npm run lint`。Android 集成测试和静态检查可通过 `npm run build:android -- :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug` 构建。在设备上安装主 APK 和测试 APK 后，可以执行下列命令运行集成测试。

```text
adb shell am instrument -w cc.idlecloud.nai.local.test/androidx.test.runner.AndroidJUnitRunner
```

在测试命令中加入 `-e loadModel true` 可验证公开 QuickSRNet 模型的下载及 CPU 加载流程。

在构建命令中加入 `-PnaiLayoutTest=true` 可以生成与验收包并装的测试应用。安装这组 APK 后，测试命令中的应用包名改为 `cc.idlecloud.nai.local.layouttest.test`。
