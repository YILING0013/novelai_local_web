# 源码 Web 版本地反推与放大

在侧栏打开 **提示词反推** 或 **本地放大**，选择图片和模型后开始处理。首次使用会下载并校验所选模型，也可先点击 **下载模型**。反推结果可以复制或发送到绘画，本地放大结果会保存到生成画廊，也可直接下载。手机通过浏览器访问电脑时，模型在电脑上运行。

Windows 和 Android 应用随包提供原生运行时。以下配置用于通过 `setup.bat` 和 `start.bat` 运行的源码 Web 版。 [安装与启动](../README.md#从源码运行与开发)

## 选择模型

| 用途 | 模型 | 下载量 |
| --- | --- | ---: |
| 反推 | SwinV2 v3 | 约 468 MB |
| 反推 | PixAI FP32 / FP16 / INT8 | 约 1.99 GB / 994 MB / 549 MB |
| 放大 | waifu2x、QuickSRNet 或 Real-ESRGAN | 约 0.15–19 MB |

本地推理使用已下载的模型。开启反推结果的中文释义时，词库未命中的标签会发送到在线翻译服务。模型的下载地址和版本可从界面或 [模型清单](../nai_flask/api_utils/inference_models.json) 查看。

## 模型目录和设备

如需修改模型目录、运行设备或线程数，在 `nai_flask/config.local.json` 中修改这些字段并重启服务。未设置模型目录时使用 `data_dir/models`，相对路径以 `nai_flask` 为基准。迁移缓存时复制完整的模型和版本目录。

```json
{
  "inference_models_dir": "E:/NovelAIModels",
  "inference_device": "auto",
  "inference_threads": 4
}
```

默认依赖支持 CPU。`auto` 根据已安装的运行库选择设备。需要 GPU 时，先关闭服务，再在 `nai_flask` 中执行对应的一组命令。三个 ONNX Runtime 包共用同一 Python 模块，每次只保留一种。

```powershell
# Windows DirectML
.\.venv\Scripts\python.exe -m pip uninstall -y onnxruntime onnxruntime-gpu
.\.venv\Scripts\python.exe -m pip install "onnxruntime-directml>=1.24,<2"

# 或使用 NVIDIA CUDA
.\.venv\Scripts\python.exe -m pip uninstall -y onnxruntime onnxruntime-directml
.\.venv\Scripts\python.exe -m pip install "onnxruntime-gpu>=1.24,<2"
```

CUDA 依赖匹配的驱动、CUDA 和 cuDNN。再次运行 `setup.bat` 更新项目后，使用 GPU 的环境需重新替换对应运行库。 [CUDA 运行库要求](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)

下载失败时检查模型发布地址的网络连接。加载失败时核对可用内存及设备运行库。处理完成后，可用 **释放模型内存** 卸载当前模型。
