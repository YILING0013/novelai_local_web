# 来源与许可证声明

本项目是以下两个现有项目的本地功能精简版本。迁移采用逐文件白名单，保留的
前端 UI、NovelAI 参数组件和 payload 构造均来自原项目当前工作树，再在对应原
文件中删除与 NovelAI 无关的分支。

- 前端：`next_nai_web`
  - 来源：<https://github.com/YILING0013/next_nai_web.git>
  - 迁移基准：`e99b72e268426e1fe839e56289220ccbcd8504c3`
  - 原许可证：GNU Affero General Public License v3.0
- 后端：`nai_flask`
  - 来源：<https://github.com/YILING0013/nai_flask.git>
  - 迁移基准：`508f3a3ba216f3df8bca9bb93a311a23dd5227ed`
  - 原许可证：GNU General Public License v3.0

迁移时原后端工作树另有与监控模块相关的未提交改动；该模块不属于本地版功能
白名单，因此没有迁入。两个子目录各自保留原许可证文本；仓库根许可证适用于
本地版新增与整合作品。第三方依赖仍按其各自许可证发布。

`change_account_password` 参考项目只用于确认互操作协议和测试行为，其目录没有明确
开源许可证。本项目没有直接复制该目录源码；账号凭据与 keystore 兼容实现是按
协议事实重新编写，并在本项目许可证下发布。

NovelAI、NovelAI 标识及其服务属于 Anlatan。此项目不是 NovelAI 官方产品，也
不会附带、收集或分发任何 NovelAI Token、账号密码或服务端账号数据。
