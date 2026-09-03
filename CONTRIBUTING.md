# 贡献指南

感谢参与 NovelAI Local Web。请先阅读 [README](README.md)，保持本项目的本地运行边界：Next.js 静态前端、Flask/Waitress 后端，以及由用户自行配置的 NovelAI 账户。

## 开发环境

- Python 3.11+、Node.js 20+ 和 npm；CI 当前使用 Python 3.11 与 Node.js 20。
- Windows 可先运行 `setup.bat`，创建 `nai_flask/.venv`、安装依赖并构建前端，再通过 `start.bat` 启动。
- 手动安装时，在 `nai_flask` 创建虚拟环境并执行 `python -m pip install -r requirements.txt`；在 `next_nai_web` 执行 `npm ci`。
- 本地配置请参考仓库配置示例，真实配置和凭据不得提交。前端修改后需要重新构建静态文件。

## 提交范围与本地数据

贡献的是功能代码、结构定义、迁移逻辑及必要的合成测试，不能附带开发者自己的使用数据。

| 内容 | 处理要求 |
| --- | --- |
| `nai_flask/data/`、其他 `data/`、`runtime_data/` | 不提交，包括 JSON、上传图片、日志、备份及迁移输入 |
| SQLite 数据库 | 不提交 `*.db`、`*.sqlite`、`*.sqlite3` 及其 WAL、SHM、journal 文件；不要通过改后缀或 SQL dump 提交数据 |
| 提示词模板 | 可以提交编辑器代码；不要提交个人模板、浏览器 localStorage 导出或硬编码的个人默认模板 |
| 画师串、图片参考 | 可以提交空表初始化、API、界面和迁移代码；不要提交个人画师串记录、参考图、图片 Base64 或数据库 BLOB |
| 配置与凭据 | 不提交 `config.local*`、`.env*` 中的真实配置、Token、Cookie、浏览器登录状态；明确的无密钥示例除外 |
| 构建与运行产物 | 不提交 `.next/`、`out/`、`node_modules/`、虚拟环境、截图、临时诊断输出或生成图片 |

上游已经跟踪的 `next_nai_web/public/reference_img/` 资源不代表可以继续向该目录添加个人参考图。修改已有公共资源应单独说明来源、用途及授权；普通功能 PR 不应改动它们。

`.gitignore` 只能防止未跟踪文件被误添加，不能保护已经跟踪的文件。禁止依赖忽略规则代替审查，也不要使用 `git add -f` 绕过它们。推荐使用明确文件列表暂存，避免直接 `git add .`。

测试应使用临时目录和程序生成的小图片，例如现有测试的 `PNG_BASE64`，不能依赖真实 Token、个人数据库或付费生成请求。数据库迁移应使用合成旧数据，验证重启幂等性、记录保留及图片归属；默认启动应可从空数据目录完成。

## 代码约定

- 沿用现有 React/MUI 组件、`ApiClient` 和 Flask 错误响应方式。
- 新的本地读接口需要会话校验，写接口需要会话与 CSRF 校验。上传内容需验证格式、大小和数量。
- 存储变更应说明数据位置、兼容与迁移行为；不要在测试或构建时读取开发者的真实数据。
- 保持既有中英文翻译键一致；新增页面如果尚未完成双语正文，应在 PR 中说明。
- Windows 专用辅助脚本必须说明平台要求；不要把个人绝对路径或登录启动项写入仓库。
- 不要重新引入已移除的远程站点依赖或额外生成服务。

## 验证

后端命令在 `nai_flask` 执行，并使用已经安装依赖的虚拟环境 Python：

```sh
python -m compileall -q api_utils app.py tests
python -m pytest -q
```

前端命令在 `next_nai_web` 执行：

```sh
npm test
npm run lint
npm run build
```

前端构建完成后，在仓库根目录执行：

```sh
python scripts/verify_release.py
```

依赖安全检查遵循 `.github/workflows/ci.yml`：后端使用 `pip-audit -r requirements.txt`，前端使用 `npm audit --audit-level=high`。不要为了消除告警执行未经评估的强制升级。记录实际结果，失败或未执行的项目应明确标出。

界面变更还应验证空状态、创建/编辑/删除、图片查看、刷新后持久化，以及应用提示词/参数到绘画的行为；生成相关变更应区分成功、失败、取消与批量场景。可使用合成数据和模拟上游，避免消耗真实账户额度。未完成的交互检查需要在 PR 中列出。

## PR 流程

1. 获取上游最新 `main`，记录比较基线，并检查本地未提交内容。
2. 从上游创建主题分支（例如 `codex/contributing-guide`）。没有写权限时推送到自己的 fork。
3. 文档先行时，第一条 PR 只包含 `CONTRIBUTING.md`，不夹带功能代码或忽略规则。
4. 后续功能 PR 按本指南整理，链接先行文档 PR。可从同一上游基线创建独立分支，使功能 PR 不重复包含尚未合并的文档提交。
5. 分组暂存代码，检查以下输出，确认既没有个人数据，也没有不相关文件：

```sh
git status --short --untracked-files=all
git diff --cached --name-status
git diff --cached --check
git diff --cached
```

6. 推送前检查整个分支，而不只检查最后一次提交：

```sh
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
git diff --check origin/main...HEAD
```

此处假设 `origin` 指向上游；如果 `origin` 是自己的 fork，请改用上游 remote 名称。确认将要推送的所有提交均不含个人数据后，再创建 PR。

PR 说明应包含：问题与新行为、涉及模块、实际测试结果、数据边界、迁移影响、平台限制及尚未验证的场景。维护者决定合并时机，创建 PR 不代表自动合并。

## 本次本地差异清单（2026-09-03）

比较基线：`YILING0013/novelai_local_web` 的 `main`，提交 `6cddeda`。此清单描述整理贡献时的本地工作区，不表示这些功能已经进入上游。

| 差异 | 后续贡献范围 |
| --- | --- |
| 画师串与图片参考库 | SQLite 表与图片 BLOB 存储、旧 JSON 迁移、带会话/CSRF 的 CRUD 接口、临时数据测试 |
| 参考库界面 | 两个独立入口、瀑布流与大图、搜索、编辑/删除、向绘画页面传递提示词或已有参数 |
| 提示词模板 | 浏览器 localStorage 中的片段开关、排序、编辑与组合应用；初始为空，不包含个人模板 |
| 绘画工作区 | 成功出图后刷新种子、空结果提示、参考参数和模板的跨页面应用 |
| 导航与文案 | 页面配置、入口翻译键以及中英文空状态文案 |
| 后台启动 | Windows 专用 `scripts/start-background.py`，进程锁、端口检查和本地日志；不安装个人启动项 |
| 提交保护 | 补充数据库及个人参考图片的忽略规则，检查最终差异不含本地数据 |

后续 PR 应按实际验证结果更新其说明；不要把本清单当作所有功能已经验证通过的证明。
