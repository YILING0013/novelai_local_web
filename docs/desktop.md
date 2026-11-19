# NovelAI Local：Windows 桌面版

安装、登录、本机工具和局域网访问见 [README](../README.md#windows-桌面版)。工作区的设置也可以用 **Ctrl+,** 打开。再次启动会恢复桌面会话，退出登录会清除保存的令牌。

## 从源码构建

在 Windows x64 上准备 Rust MSVC 工具链、Windows SDK、Node.js、npm、WebView2 和用于编译 OpenSSL 的 Perl。从仓库根目录执行：

```powershell
Set-Location next_nai_web
npm.cmd ci
npm.cmd run prepare:runtime
npm.cmd run desktop:build
```

NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`。

## 验证

前端在 `next_nai_web` 运行 `npm.cmd test` 和 `npm.cmd run lint`。在仓库根目录运行 Rust 测试：

```powershell
$env:NOVELAI_UNIT_TEST_MANIFEST = '1'
cargo test --release --locked --manifest-path src-tauri/Cargo.toml --lib
Remove-Item Env:NOVELAI_UNIT_TEST_MANIFEST
```

`NOVELAI_UNIT_TEST_MANIFEST` 仅用于测试。接口实现位置见 [Flask 与 Rust API 对照](api-migration.md)。

## 自动更新与发布

1. 更新 `next_nai_web/package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本号，同步锁文件并提交推送。准备对应的 `docs/releases/<版本>.md`。
2. 安装并登录 GitHub CLI。发布脚本使用与应用内公钥匹配的更新签名私钥，默认路径为 `%USERPROFILE%\.tauri\novelai-local\updater.key`，也可通过 `-KeyPath` 指定。保护并备份私钥，后续更新沿用同一签名。
3. 在仓库根目录运行以下命令构建安装包。验收 `output/releases/<版本>/` 中的产物后，加 `-Publish` 发布同一份安装包。

```powershell
.\scripts\publish-desktop.ps1 -NotesFile (Read-Host '更新日志路径')
.\scripts\publish-desktop.ps1 -NotesFile (Read-Host '同一份更新日志路径') -Publish
```

桌面更新读取 [latest.json](https://github.com/YILING0013/novelai_local_web/releases/latest/download/latest.json)。Tauri 用更新签名校验安装包，Windows 发布者认证由 Authenticode 签名单独提供。
