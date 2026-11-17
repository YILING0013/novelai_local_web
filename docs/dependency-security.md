# 依赖安全维护（2026-11-16）

本次修复开源本地版前端、兼容 Flask 后端与 Windows Rust 桌面端已发现的依赖漏洞，包括开发工具的中危问题。

| 依赖 | 本次版本或约束 |
| --- | --- |
| Next.js / eslint-config-next | 15.5.28 |
| Sharp | 覆盖至 0.35.5 |
| brace-expansion | 1.x 使用 1.1.21；2.x 使用 2.1.7 |
| Pillow | >=13.0.0,<14 |
| Zip | 最低 9.0.5，Cargo.lock 锁定 9.5.1 |
| rusqlite / libsqlite3-sys | 0.41.1 / 0.39.1，内置 SQLite 3.54.1 |

前端锁文件同时升级 typescript-eslint 工具链与 sucrase，并更新 postcss-selector-parser 的兼容补丁版本。

修复依据：[Next.js 公告](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、[Sharp 公告](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[brace-expansion 公告](https://github.com/advisories/GHSA-qhr7-859c-m2p7)、[Pillow 13 发布说明](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html)、[Zip 公告](https://github.com/advisories/GHSA-m665-v7pm-7grj)。

## 扫描范围与保留问题

- npm audit：全部依赖及生产依赖均无已知漏洞。
- pip-audit：扫描本仓库 Flask 虚拟环境的全部已安装包，无已知漏洞。
- OSV：按 Windows x64 实际依赖图查询，无已知漏洞。完整 Cargo.lock 仍包含 Linux GTK3 使用的 glib 0.18.5 公告，以及非 Windows 依赖的停止维护提示；这些包不进入 Windows 安装包。Tauri 2 尚无兼容的 glib 修复版本，未通过忽略公告或删除锁文件条目掩盖提示。本次不发布 Linux 安装包，也不宣称全平台依赖没有告警。

SQLite 修复依据：[RUSTSEC-2026-0459](https://rustsec.org/advisories/RUSTSEC-2026-0459.html)。glib 上游状态：[Tauri 跟踪问题](https://github.com/tauri-apps/tauri/issues/12564)。

扫描是该日期的公开漏洞库结果，不能保证以后没有新公告。原始扫描输出保存在仓库外的本机工作目录，不随源码或安装包分发。

## 使用源码时更新

前端每次按锁文件安装并重新构建，不能只替换 package.json：

```powershell
Set-Location next_nai_web
npm.cmd ci
npm.cmd test
npm.cmd run build:bundle
```

仍使用兼容 Flask 服务的环境，在自己的虚拟环境内更新 `nai_flask/requirements.txt` 并重启该服务。桌面 Rust 运行时不使用 Python；桌面用户安装新版安装包即可。Rust 构建继续使用 `--locked`，不需要额外全量升级依赖。

本次没有环境变量、端口、目录、权限或资料迁移变化；新旧客户端使用同一资料格式。不修改账号、图片、作品或模型权重。构建或测试失败时保留原安装版本，停止替换安装包。旧版本包含已知漏洞，不建议作为长期回退版本。
