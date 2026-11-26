# 本地 Web 版

从 GitHub Release 下载并解压 `NovelAI-Local-Web.zip`。压缩包包含已编译的网页和 Flask 后端。运行需要 Python 3.12。首次安装 Python 依赖需要联网。

在解压后的目录打开终端。Windows 使用以下命令。

```powershell
python -m venv nai_flask/.venv
.\nai_flask\.venv\Scripts\python.exe -m pip install -r nai_flask/requirements.txt
.\nai_flask\.venv\Scripts\python.exe nai_flask/app.py
```

Linux 和 macOS 使用以下命令。

```sh
python3 -m venv nai_flask/.venv
nai_flask/.venv/bin/python -m pip install -r nai_flask/requirements.txt
nai_flask/.venv/bin/python nai_flask/app.py
```

打开 [本机工作区](http://127.0.0.1:5000)，在终端按 Ctrl+C 停止服务。个人数据默认保存在 `nai_flask/data`。升级前备份该目录及自己的 `config.local.json`，再用新包中的程序文件升级。
