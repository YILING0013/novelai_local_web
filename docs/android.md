# NovelAI Local Android

安装、登录、本机工具、更新和数据导出见 [README](../README.md#android-本地版)。Android 包名为 `cc.idlecloud.nai.local`。

## 从源码构建

准备 Node.js 24、JDK 21、Rust、cargo-ndk、Android SDK Platform 36 和 NDK 28.2.13676358，设置 `JAVA_HOME` 和 `ANDROID_HOME`。从仓库根目录执行：

```powershell
rustup target add aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk --locked
Set-Location next_nai_web
npm.cmd ci
npm.cmd run build:android
```

Linux、macOS 使用 `npm`。调试 APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。回到仓库根目录后可用 `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` 安装。

## 验证

在 `next_nai_web` 运行 `npm test`、`npm run lint` 和下列构建命令：

```sh
npm run build:android -- :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
```

在设备上安装主 APK 和测试 APK 后运行：

```sh
adb shell am instrument -w cc.idlecloud.nai.local.test/androidx.test.runner.AndroidJUnitRunner
```

加 `-e loadModel true` 可验证 QuickSRNet 模型下载与 CPU 加载。若构建时指定 `-PnaiLayoutTest=true`，测试包名改为 `cc.idlecloud.nai.local.layouttest.test`，可与正式版并装。

## 应用更新与发布

1. 保留包名和正式签名，在 `android/app/build.gradle` 递增 `versionName` 和 `versionCode`。
2. 从对应版本的干净提交构建。设置 `NAI_LOCAL_ANDROID_KEYSTORE`、`NAI_LOCAL_ANDROID_STORE_PASSWORD`、`NAI_LOCAL_ANDROID_KEY_ALIAS` 和 `NAI_LOCAL_ANDROID_KEY_PASSWORD`，在 `next_nai_web` 执行 `npm run build:android -- :app:assembleRelease :app:lintRelease`。Windows 开发工作区也可从仓库根目录运行 `android/release.ps1`，使用本机已配置的发布签名。
3. 用 `apksigner verify --print-certs` 检查 `android/app/build/outputs/apk/release/app-release.apk`，将其命名为 `NovelAI-Local-Android-<版本>.apk`。发布到本仓库的 `android-v<版本>` Release，并保留 Windows 发布页的 **Latest** 标记。
