# 贡献指南

先按目标平台准备环境。 [源码 Web](README.md#从源码运行与开发) · [Windows](docs/desktop.md#从源码构建) · [Android](docs/android.md#从源码构建)

## 开发约定

- 前端复用现有 React / MUI 组件和 `ApiClient`，保持中英文翻译同步。源码 Web 版修改前端后需重新构建静态页面。
- 本地接口沿用现有访问边界。HTTP 读写走会话校验，写操作同时检查来源与 CSRF。上传须检查文件格式、大小和数量。
- 测试使用临时目录、合成图片与模拟上游。涉及存储变更时，用合成的旧数据检查迁移、重复启动与数据归属，并确认可以从空目录启动。
- 生成变更应验证成功、失败、取消与批量流程。界面变更检查涉及的编辑、保存、刷新恢复及参数回填操作。

## 验证

在 `nai_flask` 的虚拟环境中运行：

```sh
python -m compileall -q api_utils app.py tests
python -m pytest -q
pip-audit -r requirements.txt
```

在 `next_nai_web` 中运行：

```sh
npm ci
npm test
npm run lint
npm run build
npm audit --audit-level=high
```

构建后，从仓库根目录运行 `python scripts/verify_release.py`。Windows 和 Android 的原生构建与测试见各自平台指南。

## 提交前检查

1. 核对上游基线和工作区，完成相关测试。按明确文件路径暂存与变更相关的源码、依赖、文档和测试。
2. 检查 `git diff --cached --name-status` 和 `git diff --cached --check`。账号凭据、个人图库与浏览器数据、SQLite 文件、日志、调试截图、构建产物和模型缓存不进入提交。
3. 提交 PR 前审查分支相对上游 `main` 的完整差异。PR 写明变更、测试结果和影响用户的兼容性事项。
