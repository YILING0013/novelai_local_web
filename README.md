# NovelAI Local Web

NovelAI Local Web 是从现有 `next_nai_web` 与 `nai_flask` **删除无关功能后得到**
的本机个人版。它保留原项目的绘画页面、桌面与移动端布局、主题与配色、提示词
编辑器、随机提示词、提示词笔记、灵感画廊以及 NovelAI 图像参数实现，不是另起
炉灶重写的一套前端。

项目只监听 `127.0.0.1`，不需要 Redis、数据库、账号池、代理、后台队列或云端
配置。浏览器通过本机 Flask 后端把请求发送到 `https://image.novelai.net`。

## 保留的功能

- NovelAI V3、Furry V3、V4 Full/Curated、V4.5 Full/Curated、V5 Full/Curated。
- 文生图、图生图、局部重绘、角色提示词与位置、Vibe、Director Reference 和
  Director Tools。
- NovelAI 官方 Upscale、Augment、Vibe 编码与官方标签建议。
- 原提示词编辑器、V4/V5 tokenizer、随机提示词、提示词笔记、PNG 元数据读取与
  参数回填、图片预览/下载、自动保存及命名设置。
- 原 `metadata.json` 与 86 张 `reference_img` 灵感图。
- 原主题、语言、背景、动画、页面配色和图片保存设置。首次默认英文，用户选择
  中文后会在浏览器中保留。
- Persistent Token 登录，以及在本机派生 access key 的邮箱密码登录。
- 官方账户信息、订阅、固定/购买/总 Anlas、到期时间和 V5 状态显示。
- 密码登录会话的改密、改邮与中断恢复；每次操作都必须重新输入当前密码。

## 已移除的内容

Krea、Gemini、Wan、视频、聊天、翻译、第三方标签预测、自建超分、云存储、管理
员、公告、兑换、购买、站内账号与权限、Redis 队列、账号池、验证码、Turnstile、
反调试、PWA、安全 WASM、自定义请求加密、加密响应以及旧 V5 私有结果交付协议
均不进入本地版。

## 安装

需要：

- Windows 10/11
- Python 3.11 或更高版本
- Node.js 20 或更高版本

首次使用时双击根目录的 `setup.bat`。脚本会分别安装 Python 和 Node.js 依赖，
并把原 Next.js 前端构建为静态页面。依赖和构建产物只保存在本项目目录，且均被
Git 忽略。

也可以在终端运行：

```powershell
.\setup.bat
```

## 启动

双击根目录的 `start.bat`。启动器会：

1. 检查配置的 loopback 端口（默认 `127.0.0.1:5000`）；确认是本项目服务时会
   直接复用，否则停止并提示，不会自动更换端口。
2. 启动单进程 Flask/Waitress，由它同源提供静态页面和 `/api`。
3. 打开配置端口的登录页；默认地址是 <http://127.0.0.1:5000/login>。
4. 保持当前窗口运行；按 `Ctrl+C` 或关闭窗口会结束本次启动的服务。

## 本地配置

默认无需创建配置文件。如需调整端口、数据目录或官方请求超时，请复制
`nai_flask/config.example.json` 为同目录下的 `config.local.json` 后修改。
配置文件已被 Git 忽略；其中不能保存 Token、邮箱或密码。官方 API 地址固定为
`https://image.novelai.net`，不能通过配置改成旧代理或第三方服务。

## 登录与凭据安全

登录页提供两个同等入口：

- Persistent Token：推荐方式。Token 仅保存在 Flask 进程内存中。
- 邮箱密码：密码只在本机用于 Argon2id 派生 access key，原始密码不会发送给
  NovelAI、不会保存到磁盘，也不会写入日志。

浏览器 Cookie 只包含随机会话 ID；PAT、JWT、密码、access key 和 encryption
key 都不会写入 Cookie、localStorage、本地 JSON、URL、错误响应或导出文件。
退出、浏览器会话结束、后端重启或官方返回 401 后，会话随即失效。

请不要把 Token 写进 `config.local.json` 或任何源码文件。如果凭据曾出现在聊天、
终端历史或截图中，请立即在 NovelAI 官方页面轮换。

## 改密与改邮

这两个功能使用 NovelAI 网页端当前兼容的 `/user/change-access-key` 与 keystore
协议，可能随官方变更而失效。操作前务必从官方网页备份重要故事。

流程会重新登录、读取并认证远端 keystore、使用目标凭据重包并本地自校验，随后
只调用一次凭据 mutation，再写回、回读并比较明文摘要。任何超时或结果不确定都
不会自动重试。恢复日志只包含阶段、时间、摘要、change index 和关联 ID，不含
邮箱、密码、Token 或密钥。真实发布前请使用专用测试账号人工验证一次。

如果 NovelAI 将来强制官方验证码，密码登录会失败关闭并提示改用 Persistent
Token；本项目不会重新实现验证码或尝试绕过官方机制。

## 连续生成

一次人工点击可连续生成 1–8 张。每个官方请求固定 `n_samples=1`，一张成功后会
立刻显示，再等待 15 秒请求下一张；最后一张不等待。429、超时、断连、5xx、响应
损坏或结果不确定时会立即停止整批，已经成功的图片仍留在当前浏览器页面。项目
不提供计划任务、无头生成、后台续跑或自动重试。

NovelAI 官方文档要求图像请求由人工动作发起；“一次点击连续请求多张”仍可能
存在兼容性解释风险，请自行遵守 [NovelAI 服务条款](https://novelai.net/terms)
和 [Image API 文档](https://image.novelai.net/docs/index.html)。

## 本地数据

默认数据目录仅保存设置、随机提示词、提示词笔记与非敏感恢复状态。生成图片只
存在于当前浏览器会话，除非手动下载或启用自动保存。`data/`、本地配置、临时
文件和恢复日志都已加入 `.gitignore`。

## 开发与测试

```powershell
# 后端
cd nai_flask
.\.venv\Scripts\python.exe -m pytest

# 前端
cd ..\next_nai_web
npm test
npx eslint src
npm run build

# 源码、静态产物和凭据边界扫描
cd ..
.\nai_flask\.venv\Scripts\python.exe .\scripts\verify_release.py
```

所有自动化测试都应使用假官方接口。真实登录、生成和账号变更冒烟测试必须由
维护者显式启用，并使用自己可轮换的专用测试账号。仓库附带的 GitHub Actions
只执行假接口测试、lint、静态构建和依赖审计，不读取任何 NovelAI 凭据。

## 许可证与来源

本地整合项目按 GNU AGPL-3.0 发布。前端与后端的原始许可证、来源和迁移基准见
[NOTICE.md](NOTICE.md)。网络部署修改版时，请遵守 AGPL-3.0 的源码提供要求。
