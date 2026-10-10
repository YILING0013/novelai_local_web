# Python 本地反推与放大

“提示词反推”和“本地放大”由本机后端运行。首次点击下载、加载或处理时，后端把选定模型下载到磁盘；浏览器无需导入 ONNX 文件，手机访问时也使用电脑的模型和算力。

## 安装与使用

1. 更新源码后停止旧服务，运行根目录的 `setup.bat`。它通过 `nai_flask/requirements.txt` 安装 NumPy 和 CPU 版 ONNX Runtime，并重新构建前端。
2. 运行 `start.bat`，登录本地工作区，在侧栏打开“提示词反推”或“本地放大”。
3. 选择模型和图片，点击开始。缺少文件时自动下载；也可以事先点击“下载模型”。下载进度、校验、加载和推理状态分别显示。
4. 反推结果可以复制或发送到绘画的正向提示词；放大结果自动进入当前生成输出目录及本地图库，也可以下载 PNG。

图片推理只访问本地后端；初次获取模型需要能访问其发布地址。反推页的中文释义默认关闭，启用后先查询本地词库，再把未命中的标签文字发送到在线 Index-Translate 服务。关闭释义即可只使用本地推理结果。

## 模型目录

在 `nai_flask/config.local.json` 中设置以下字段，然后重启后端：

```json
{
  "inference_models_dir": "E:/NovelAIModels",
  "inference_device": "auto",
  "inference_threads": 4
}
```

- `inference_models_dir` 留空使用当前 `data_dir/models`。相对路径以 `nai_flask` 为基准，绝对路径可放到有足够空间的磁盘。
- 文件按 `<模型 ID>/<固定版本>/` 存放。清单固定下载地址、字节数和 SHA256；完整校验通过后才采用文件。后端仅下载固定模型资源，不执行模型仓库中的 Python 代码。
- 支持普通模型文件的 HTTP Range 续传，未完成文件以 `.part` 保留；下载源不支持续传时从头写入。QuickSRNet 的小 ZIP 发布包会重新下载并校验其中的指定文件。
- 改目录不会迁移或删除原目录。需要沿用缓存时，在停止服务后复制完整模型 ID / 版本目录到新位置。
- 模型缓存不包含账户凭据，不需要进入 Git。备份工作区时可另行保存模型缓存，或让后端重新下载。

## 反推模型

| 模型 | 下载量约 | 说明 |
| --- | ---: | --- |
| SwinV2 v3 | 468 MB | FP32，448 像素输入；一般标签与角色 |
| PixAI v1.0 FP32 | 1.985 GB | 完整精度 ONNX，1008 像素输入，30,877 个输出标签 |
| PixAI v1.0 FP16 | 994 MB | 半精度权重，适合兼容的 GPU |
| PixAI v1.0 INT8 | 549 MB | 量化权重，内存占用和速度取决于设备；结果可能与 FP32 不同 |

PixAI 使用 [原始模型](https://huggingface.co/pixai-labs/pixai-tagger-v1.0) 的[社区 ONNX 导出](https://huggingface.co/Mexes/pixai-tagger-v1.0-onnx-fp32-fp16-int8)。完整精度指 FP32 导出，不是把量化文件转换回 FP32。建议运行 FP32 的电脑至少有 16 GB 内存，模型加载时的峰值内存显著高于下载大小。

按模型约定处理 RGB / BGR、输入排列、缩放和补边。PixAI 默认分类阈值来自发布说明，一般标签和角色阈值可在页面调整。结果保留风格、作品、其他类别，过滤 rating 分类；调整阈值后重新运行。

## 放大模型

| 模型 | 下载量约 |
| --- | ---: |
| waifu2x Swin_UNet Art ×4 | 18.91 MB |
| QuickSRNet Small ×4 | 0.153 MB |
| Real-ESRGAN Anime 6B ×4 | 17.94 MB |
| Real-ESRGAN General x4v3 | 4.87 MB |
| Real-ESRGAN AnimeVideo v3 ×4 | 2.49 MB |

可选 2 / 3 / 4 倍。网络按原生 4 倍计算，再缩小到所选尺寸；通过重叠分块合成，保留 Alpha 和可识别的源图提示词、参数，并记录放大模型及倍数。原生输出限制为 3200 万像素、单边 16384 像素；结果也受图库单文件 30 MiB 限制。原图不会被覆盖。

页面的模型来源按钮提供发布地址和许可证；所有下载版本、校验值见 `nai_flask/api_utils/inference_models.json`。

## CPU 与可选 GPU

默认 CPU 可直接使用。`auto` 从已安装运行库提供的 CUDA、DirectML、CPU 中选择；页面显示实际执行设备。显式选择不可用的 GPU 会报错，不会显示为 GPU 成功运行。

可选 GPU 使用对应 ONNX Runtime 包，它们共享 `onnxruntime` 模块，不能与 CPU 包混装。停止后端后，在 `nai_flask` 目录按需操作：

```powershell
# Windows DirectML：先卸载同名模块的其他变体，再安装 DirectML。
.\.venv\Scripts\python.exe -m pip uninstall -y onnxruntime onnxruntime-gpu
.\.venv\Scripts\python.exe -m pip install "onnxruntime-directml>=1.24,<2"

# 或者 NVIDIA CUDA：不要与上面的 DirectML 同时安装。
.\.venv\Scripts\python.exe -m pip uninstall -y onnxruntime onnxruntime-directml
.\.venv\Scripts\python.exe -m pip install "onnxruntime-gpu>=1.24,<2"
```

CUDA 还需与所装版本匹配的驱动、CUDA / cuDNN；以 [ONNX Runtime CUDA 文档](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html) 为准。DirectML 会禁用 memory pattern 并使用顺序执行，遵循 [DirectML 文档](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)。GPU 路径未在本轮机器上实测。

重新执行 `setup.bat` 会安装默认 CPU 包；使用 GPU 的环境在更新后需重新执行上面对应的替换步骤。需要回到 CPU 时，卸载两个 GPU 变体，再执行 `python -m pip install -r requirements.txt`。

## 任务、取消与故障

- 一台后端同时处理一个任务，只保留一个加载中的模型会话。切换模型会释放旧会话，页面也提供“释放模型内存”。
- 取消下载保留片段；推理取消向 ONNX Runtime 发送终止请求。模型构造阶段需等待运行库返回后才能释放，界面会保持“正在取消”。
- 放大结果开始写入图库后不再接受取消，避免出现“已取消但文件已经保存”。保存失败会明确显示失败。
- 切换页面或刷新浏览器不会停止后端任务，当前登录会话可重新获取最近任务。后端重启后任务状态清空，但已下载模型和已保存图片保留。
- 下载失败先检查发布站点网络；校验失败重新点击下载；加载失败检查可用内存、运行库与设备。后端日志保留模型 ID、阶段和错误类别，不输出图片、标签内容或会话凭据。

本轮已实际验证 WD SwinV2 v3 和 PixAI v1.0 FP32 完整权重的自动下载、SHA256 校验和 CPU 反推；QuickSRNet、Real-ESRGAN Anime 6B、waifu2x 完成 CPU 放大并保存透明 PNG，QuickSRNet 还验证了图库读取与浏览器下载。FP16、INT8 和 GPU 尚未实测。自动测试覆盖预处理、标签顺序、分类阈值、下载续传、任务授权与取消等关键边界。
