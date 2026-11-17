# 依赖安全维护（2026-11-16）

本次修复开源本地版前端、兼容 Flask 后端与 Rust 桌面端已发现的高危、严重依赖漏洞。

| 依赖 | 本次版本或约束 |
| --- | --- |
| Next.js / eslint-config-next | 15.5.28 |
| Sharp | 覆盖至 0.35.5 |
| brace-expansion | 1.x 使用 1.1.21；2.x 使用 2.1.7 |
| Pillow | >=13.0.0,<14 |
| Zip | 最低 9.0.5，Cargo.lock 锁定 9.5.1 |

修复依据：[Next.js 公告](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、[Sharp 公告](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[brace-expansion 公告](https://github.com/advisories/GHSA-qhr7-859c-m2p7)、[Pillow 13 发布说明](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html)、[Zip 公告](https://github.com/advisories/GHSA-m665-v7pm-7grj)。

## 扫描范围与保留问题

- npm audit：高危、严重均为 0；开发依赖仍有 9 项中危，生产依赖扫描无已知漏洞。
- pip-audit：扫描本仓库 Flask 虚拟环境的全部已安装包，无已知漏洞。
- OSV：按 Cargo.lock 查询全部 639 个注册表依赖，包括非 Windows 目标；有 CVSS 评分的高危、严重均为 0。仍有 glib、libsqlite3-sys 两项中危，以及 proc-macro-error、zbus_names、zvariant、zvariant_derive 停止维护提示。

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
