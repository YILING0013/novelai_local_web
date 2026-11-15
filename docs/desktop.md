# NovelAI Local：Windows 桌面版

运行 x64 NSIS 安装包，选择简体中文或英文。从开始菜单打开 **NovelAI Local**。首次启动进入登录窗；可以输入 NovelAI 官方 Token、使用邮箱密码登录，也可以从标题栏的本机工具按钮离线进入工作区。再次启动会恢复已保存的桌面会话。退出登录会清除本机的可恢复令牌。

工作区左侧切换工具，标题栏从左到右提供语言、明暗主题、设置齿轮和账户。按 Ctrl+, 也可打开同一设置界面。工作区 → 设置 → **桌面应用** 中可以打开 Web 访问。默认地址为 `http://127.0.0.1:5000`；需要手机访问时，启用局域网并使用设置显示的地址。浏览器需要单独登录。同一 Windows 用户的图库、作品和模型由两个入口共享。关闭开关会立即停止 HTTP 监听并注销浏览器会话。配置仅在成功绑定后记住；启动时绑定失败不会影响桌面工作。退出程序也会关闭访问。

桌面加载安装包内 Vite 资源，经 Tauri IPC 访问 Rust；图库及文件选择结果经限域资源协议读取。可选 Web 入口使用 Axum 加载随包提供的移动版静态页面，共用 Rust 服务和 SQLite 存储。桌面不需要本机 HTTP 服务。Windows WebView2 是界面运行时，缺失时安装程序会引导下载。运行时不需要 Python、Node、Redis 或 Visual Studio。

当前用户的应用标识为 `cc.idlecloud.novelai.local`；数据目录为 `%LOCALAPPDATA%\cc.idlecloud.novelai.local`。首次安装跳过旧版数据迁移，不使用 nai_desktop 的登录令牌、应用目录或更新服务。ONNX Runtime 1.24.4 和 DirectML 1.15.4 随包，模型按需下载并校验。桌面令牌及选择记住的模型服务密钥受 Windows DPAPI 保护；密码不写入资料目录。

## 从源码构建

在 Windows x64 上准备 Rust MSVC 工具链、Windows SDK、Node/npm、Perl（静态编译 OpenSSL 时使用）和 WebView2。按锁文件安装；参考项目的本机开发环境见上级目录 AGENTS.md。

```powershell
# 当前目录：novelai_local_web；先加载上级目录的 Enable-Dev.ps1
Set-Location next_nai_web
npm.cmd ci
npm.cmd run prepare:runtime
npm.cmd test
npm.cmd run desktop:build
```

安装包生成在 `src-tauri\target\release\bundle\nsis`。桌面静态资源与 Web 静态资源分别构建；构建时通过固定允许清单核验资源，个人图片、账号、模型权重、Python 环境和本机数据库不打包。正式版启用 Tauri 更新签名与自动更新。Tauri 更新签名用于校验安装包，并不等同于 Windows Authenticode 发布者证书。

## 验证

```powershell
# 当前目录：novelai_local_web。此环境变量仅用于 Windows 测试宿主，不可用于打包。
$env:NOVELAI_UNIT_TEST_MANIFEST='1'
cargo test --release --locked --manifest-path src-tauri/Cargo.toml --lib
Remove-Item Env:NOVELAI_UNIT_TEST_MANIFEST
```

Rust 的 contracts 和 migration_tests 使用临时资料目录、合成账号及图片；覆盖 HTTP 与桌面共用的业务入口、文件快照、取消、恢复和端口生命周期。实际推理另行运行带固定模型的测试。旧 Flask 套件保留作基线，不计入 Rust 通过数。逐项接口清单见 [api-migration.md](api-migration.md)。安装目录中的 licenses 与 resources/runtime 保留源码来源和原生库许可。

本地安装包验收记录与截图随安装包放在工作目录，不进入 Git。真实登录、官方计费和外部模型服务按使用者配置运行，不在合成测试中调用。

## 自动更新与发布

客户端固定查询 `https://github.com/YILING0013/novelai_local_web/releases/latest/download/latest.json`。首次 2.0.0 安装包包含独立公钥，后续版本沿用同一私钥签名，并递增版本号。启动后后台检查，设置中可手动检查、下载和安装；生成、推理、Web 请求或保存期间不能安装，漫画草稿保存失败也会阻止退出。

私钥由发布者保存在用户目录之外的备份或受控密钥库；本机默认路径为 `%USERPROFILE%\.tauri\novelai-local\updater.key`。私钥不进入仓库、安装包或更新清单。丢失后无法为已安装客户端签署后续更新，必须妥善备份。发布机安装 GitHub CLI 并使用有发布权限的账号，先提交推送干净源码，再执行：

```powershell
# 仓库根目录；需已安装前端依赖、原生运行库及构建工具
.\scripts\publish-desktop.ps1 -NotesFile docs\releases\2.0.0.md
# 验收 output\releases\2.0.0 中的签名安装包，再发布同一文件
.\scripts\publish-desktop.ps1 -NotesFile docs\releases\2.0.0.md -Publish
```

更新源与公钥在 `src-tauri/tauri.conf.json` 的 `plugins.updater` 中，`requireSignedVersion=true`；`bundle.createUpdaterArtifacts=true`。首次配置和以后公钥变更都需重新构建客户端，后续常规发版只递增 package、Cargo 与 Tauri 三处版本并使用相同签名私钥。无新增运行时环境变量、Web 端口或资料目录迁移。私钥变更不是常规升级操作。

更新日志只列简短、客观的更新条目；发布步骤、验证记录和签名配置不放入面向用户的日志。
