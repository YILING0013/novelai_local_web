# 依赖安全维护

源码更新时，前端运行 `npm ci` 并重新构建，Flask 在各自的虚拟环境中安装 [requirements.txt](../nai_flask/requirements.txt)，Rust 使用 `--locked` 构建。日常检查与命令见 [贡献指南](../CONTRIBUTING.md#验证)。桌面和 Android 安装包通过应用更新获取新版。

## 2026-11-16 检查范围

该次更新涉及 Next.js、Sharp、brace-expansion、Pillow、Zip 和 SQLite。对应版本以仓库的依赖清单和锁文件为准。

当日按 Windows x64 安装包实际依赖图扫描。完整 Cargo 锁文件中仍有 Linux GTK3 路径的 glib 公告。维护 Linux 构建时应单独检查该平台的依赖图。 [SQLite 公告](https://rustsec.org/advisories/RUSTSEC-2026-0459.html) · [Tauri 的 glib 跟踪问题](https://github.com/tauri-apps/tauri/issues/12564)
