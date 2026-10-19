"""本地 Python 推理任务：固定模型下载、磁盘缓存、加载与可取消的后台计算。"""

from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import logging
import math
import os
import threading
import time
import uuid
import zipfile
from pathlib import Path

import requests
from PIL import Image

from .custom_errors import ExposableError
from .image_inference import decode_tagger_output, prepare_tagger_input, upscale_image
from .image_validation import validate_base64_image
from .local_image_library import _inspect_image


MODELS = {model["id"]: model for model in json.loads(Path(__file__).with_name("inference_models.json").read_text(encoding="utf-8"))}
PROVIDERS = {"cpu": "CPUExecutionProvider", "cuda": "CUDAExecutionProvider", "directml": "DmlExecutionProvider"}
TERMINAL_STATES = {"completed", "cancelled", "failed"}
logger = logging.getLogger(__name__)


class InferenceCancelled(Exception):
    """用户取消任务，已下载的部分文件继续保留供下次续传。"""


class LocalInference:
    """一台本地后端同时执行一个任务，只保留一个已加载模型或漫画模型组。"""

    def __init__(self, models_dir, image_library, device="auto", threads=4):
        """
        配置本地推理，不在启动服务时下载模型或加载运行库。

        Args:
            models_dir: 模型持久目录，按模型 ID 和固定版本分开存储。
            image_library: 当前本地图库，用于保存放大结果。
            device: auto、cpu、cuda 或 directml。
            threads: CPU 推理线程数。
        """
        if not isinstance(device, str) or device not in {"auto", *PROVIDERS}:
            raise ValueError("inference_device must be auto, cpu, cuda or directml.")
        if type(threads) is not int or not 1 <= threads <= 64:
            raise ValueError("inference_threads must be an integer from 1 to 64.")
        self.models_dir = Path(models_dir).expanduser().resolve()
        self.image_library = image_library
        self.device = device
        self.threads = threads
        self.lock = threading.RLock()
        self.jobs = {}
        self.active_id = None
        self.cancel_event = threading.Event()
        self.worker = None
        self.session = None
        self.session_key = None
        self.run_options = None
        self.verified_files = {}

    def status(self, owner):
        """
        返回可选模型、缓存状态及当前会话的最近任务，不暴露其他会话的任务内容。

        Args:
            owner: 已认证的本地会话 ID，仅在内存中使用。

        Returns:
            模型目录、运行库状态、模型列表、占用状态和任务快照。
        """
        try:
            import onnxruntime as ort
            providers = ort.get_available_providers()
            runtime = {"available": True, "version": ort.__version__, "providers": providers}
        except (ImportError, OSError):
            runtime = {"available": False, "providers": []}
        with self.lock:
            models = []
            for model in MODELS.values():
                folder = self.models_dir / model["id"] / model["revision"]
                cached = all((folder / file["name"]).is_file() and (folder / file["name"]).stat().st_size == file["bytes"] for file in model["files"])
                models.append({key: model[key] for key in ("id", "name", "kind", "sizeLabel", "sourceUrl", "license", "defaultThresholds") if key in model} | {
                    "cached": cached,
                    "loaded": self.session_key is not None and self.session_key[0] == model["id"],
                    "bytes": sum(file["bytes"] for file in model["files"]),
                })
            job = next((job for job in reversed(list(self.jobs.values())) if job["owner"] == owner), None)
            return {"models": models, "models_dir": str(self.models_dir), "runtime": runtime, "device": self.device,
                    "busy": self.active_id is not None, "job": self._snapshot(job) if job else None}

    def _snapshot(self, job):
        """从任务快照中去掉仅用于服务端授权的会话标记。"""
        return copy.deepcopy({key: value for key, value in job.items() if key != "owner"})

    def get_job(self, job_id, owner):
        """
        读取指定任务，其他会话和不存在的任务统一返回 404。

        Args:
            job_id: 任务 ID。
            owner: 当前已认证会话 ID。

        Returns:
            不含内部会话标记的任务快照。
        """
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None or job["owner"] != owner:
                raise ExposableError("The inference task was not found.", 404, "LOCAL_INFERENCE_NOT_FOUND")
            return self._snapshot(job)

    def cancel(self, job_id, owner):
        """
        取消当前会话的任务，保留下载片段并通知 ONNX 终止计算。

        Args:
            job_id: 用户要取消的任务 ID。
            owner: 当前已认证会话 ID。

        Returns:
            当前状态；写入结果阶段不再接受取消。
        """
        with self.lock:
            self.get_job(job_id, owner)
            job = self.jobs[job_id]
            if job["status"] not in TERMINAL_STATES and job["stage"] != "saving":
                self.cancel_event.set()
                job["status"] = "cancelling"
                if self.run_options is not None:
                    self.run_options.terminate = True
            return self._snapshot(job)

    def release(self):
        """
        释放空闲模型占用的内存，保留已下载文件。

        Returns:
            None；存在运行中的任务时抛出占用错误。
        """
        with self.lock:
            if self.active_id is not None:
                raise ExposableError("An inference task is still running.", 409, "LOCAL_INFERENCE_BUSY")
            self.session = None
            self.session_key = None

    def start(self, owner, payload):
        """
        校验任务后启动后台线程。反推和放大在缺少模型时会自动下载。

        Args:
            owner: 已认证的本地会话 ID。
            payload: action、model_id、device 及任务对应的图片和参数。

        Returns:
            可轮询的任务快照，HTTP 请求无需等待大文件下载或推理完成。
        """
        model_id = payload.get("model_id")
        if not isinstance(model_id, str) or model_id not in MODELS:
            raise ExposableError("Choose a supported local model.", 400, "LOCAL_MODEL_UNKNOWN")
        model = MODELS[model_id]
        action = payload.get("action")
        if not isinstance(action, str) or action not in {"download", "load", model["kind"]}:
            raise ExposableError("This action does not match the model.", 400, "LOCAL_INFERENCE_INVALID")
        device = payload.get("device", "cpu" if model["kind"] == "comic-lettering" else self.device)
        if not isinstance(device, str) or device not in {"auto", *PROVIDERS}:
            raise ExposableError("Choose auto, cpu, cuda or directml.", 400, "LOCAL_INFERENCE_INVALID")
        options = {"device": device, "thresholds": {}}
        if model["kind"] == "comic-lettering":
            if device not in {"auto", "cpu"}:
                raise ExposableError("Comic lettering currently uses CPU inference.", 400, "LOCAL_DEVICE_UNAVAILABLE")
            from .comic_lettering import validate_lettering_options
            options.update(validate_lettering_options(payload))
        for category in ("general", "character"):
            value = payload.get(f"{category}_threshold")
            if value is not None:
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
                    raise ExposableError("Thresholds must be between 0 and 1.", 400, "LOCAL_INFERENCE_INVALID")
                options["thresholds"][category] = value
        scale = payload.get("scale", 4)
        if type(scale) is not int or scale not in {2, 3, 4}:
            raise ExposableError("Choose 2x, 3x or 4x scaling.", 400, "LOCAL_INFERENCE_INVALID")
        options["scale"] = scale
        image_bytes = None
        if action in {"tagger", "upscale", "comic-lettering"}:
            image_bytes = base64.b64decode(validate_base64_image(payload.get("image"), "image"))
            if action == "upscale":
                with Image.open(io.BytesIO(image_bytes)) as image:
                    if image.width * image.height * 16 > 32_000_000 or max(image.size) * 4 > 16384:
                        raise ExposableError("The native 4x output exceeds the local size limit.", 400, "LOCAL_UPSCALE_SIZE")
        with self.lock:
            if self.active_id is not None:
                raise ExposableError("An inference task is still running.", 409, "LOCAL_INFERENCE_BUSY")
            # 只保留少量结果快照，避免长时间运行的后端累积全部标签结果。
            while len(self.jobs) >= 12:
                self.jobs.pop(next(iter(self.jobs)))
            job_id = uuid.uuid4().hex
            job = {"id": job_id, "owner": owner, "model_id": model_id, "kind": model["kind"], "action": action,
                   "status": "running", "stage": "queued", "completed": 0, "total": 0, "created_at": time.time()}
            self.jobs[job_id] = job
            self.active_id = job_id
            self.cancel_event = threading.Event()
            self.worker = threading.Thread(target=self._run_job, args=(job_id, model, action, image_bytes, options), name="local-inference", daemon=True)
            self.worker.start()
            return self._snapshot(job)

    def _progress(self, job_id, stage, completed=0, total=0, **fields):
        """在锁内更新下载字节数或推理块数。"""
        with self.lock:
            self.jobs[job_id].update(stage=stage, completed=completed, total=total, **fields)

    def _check_cancelled(self):
        """在每个可中止阶段检查用户取消标记。"""
        if self.cancel_event.is_set():
            raise InferenceCancelled()

    def _valid_file(self, path, file):
        """首次使用时验证完整 SHA256，之后只对变动过的磁盘文件重新计算。"""
        if not path.is_file() or path.stat().st_size != file["bytes"]:
            return False
        stamp = (path.stat().st_mtime_ns, file["bytes"])
        if self.verified_files.get(path) == stamp:
            return True
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                self._check_cancelled()
                digest.update(chunk)
        if digest.hexdigest() != file["sha256"]:
            return False
        self.verified_files[path] = stamp
        return True

    def _download(self, job_id, model):
        """下载清单中固定的文件，支持 HTTP 续传、校验及完成后的原子替换。"""
        folder = self.models_dir / model["id"] / model["revision"]
        folder.mkdir(parents=True, exist_ok=True)
        total = sum(file["bytes"] for file in model["files"])
        finished = 0
        archives = {}
        for file in model["files"]:
            self._check_cancelled()
            destination = folder / file["name"]
            self._progress(job_id, "verifying", finished, total, filename=file["name"])
            if self._valid_file(destination, file):
                finished += file["bytes"]
                continue
            partial = destination.with_suffix(destination.suffix + ".part")
            # 下载结束后才取消的任务可以直接校验并采用完整片段，无需重新下载大模型。
            if self._valid_file(partial, file):
                os.replace(partial, destination)
                finished += file["bytes"]
                continue
            if file.get("archivePath"):
                # 仅 QuickSRNet 的小型官方包走内存 ZIP；不按 ZIP 内路径向磁盘解压。
                if file["url"] not in archives:
                    self._progress(job_id, "downloading", finished, total)
                    with requests.get(file["url"], stream=True, timeout=(15, 30)) as response:
                        response.raise_for_status()
                        content = bytearray()
                        for chunk in response.iter_content(64 * 1024):
                            self._check_cancelled()
                            content.extend(chunk)
                            if len(content) > 4 * 1024 * 1024:
                                raise ExposableError("The model archive exceeds its expected size.", 502, "LOCAL_MODEL_DOWNLOAD_FAILED")
                        archives[file["url"]] = bytes(content)
                with zipfile.ZipFile(io.BytesIO(archives[file["url"]])) as archive:
                    info = archive.getinfo(file["archivePath"])
                    if info.file_size != file["bytes"]:
                        raise ExposableError("The model archive does not match the pinned release.", 502, "LOCAL_MODEL_CHECKSUM")
                    partial.write_bytes(archive.read(info))
            else:
                offset = partial.stat().st_size if partial.exists() else 0
                if offset >= file["bytes"]:
                    offset = 0
                request_headers = {"Range": f"bytes={offset}-"} if offset else {}
                with requests.get(file["url"], headers=request_headers, stream=True, timeout=(15, 30)) as response:
                    response.raise_for_status()
                    if response.status_code == 206:
                        if not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                            raise ExposableError("The model download returned an invalid range.", 502, "LOCAL_MODEL_DOWNLOAD_FAILED")
                    else:
                        # 不支持 Range 的镜像从头写入，不能把完整文件接到旧片段后面。
                        offset = 0
                    self._progress(job_id, "downloading", finished + offset, total)
                    with partial.open("ab" if offset else "wb") as handle:
                        for chunk in response.iter_content(1024 * 1024):
                            self._check_cancelled()
                            offset += len(chunk)
                            if offset > file["bytes"]:
                                raise ExposableError("The model file exceeds its pinned size.", 502, "LOCAL_MODEL_CHECKSUM")
                            handle.write(chunk)
                            self._progress(job_id, "downloading", finished + offset, total)
                        handle.flush()
                        os.fsync(handle.fileno())
            self._progress(job_id, "verifying", finished, total)
            if not self._valid_file(partial, file):
                raise ExposableError("The model file checksum does not match the pinned release.", 502, "LOCAL_MODEL_CHECKSUM")
            self._check_cancelled()
            os.replace(partial, destination)
            self.verified_files[destination] = (destination.stat().st_mtime_ns, file["bytes"])
            finished += file["bytes"]
        self._progress(job_id, "downloaded", total, total)
        return folder

    def _load_session(self, job_id, model, folder, device):
        """加载唯一模型或 CPU 漫画模型组，切换任务类型时释放上一组引用。"""
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as exc:
            raise ExposableError("Install the Python inference requirements and restart the backend.", 503, "LOCAL_INFERENCE_UNAVAILABLE") from exc
        available = ort.get_available_providers()
        provider = "CPUExecutionProvider" if model["kind"] == "comic-lettering" else (
            next((PROVIDERS[name] for name in ("cuda", "directml", "cpu") if PROVIDERS[name] in available), None)
            if device == "auto" else PROVIDERS[device])
        if provider not in available:
            raise ExposableError("The selected execution device is not installed.", 400, "LOCAL_DEVICE_UNAVAILABLE")
        key = (model["id"], provider)
        self._progress(job_id, "loading", provider=provider)
        if self.session_key != key:
            self.session = None
            self.session_key = None
            if model["kind"] == "comic-lettering":
                from .comic_lettering import ComicLettering
                try:
                    session = ComicLettering(folder, self.threads, self._valid_file, self._check_cancelled)
                except (ImportError, OSError) as exc:
                    raise ExposableError("Install the comic lettering requirements and restart the backend.", 503, "COMIC_LETTERING_UNAVAILABLE") from exc
            else:
                settings = ort.SessionOptions()
                settings.intra_op_num_threads = self.threads
                settings.log_severity_level = 3
                if provider == "DmlExecutionProvider":
                    settings.enable_mem_pattern = False
                    settings.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
                providers = [provider] if provider == "CPUExecutionProvider" else [provider, "CPUExecutionProvider"]
                session = ort.InferenceSession(str(folder / model["modelFile"]), sess_options=settings, providers=providers)
                session.disable_fallback()
                if provider not in session.get_providers():
                    raise ExposableError("The selected execution device could not be initialized.", 500, "LOCAL_DEVICE_UNAVAILABLE")
            self._check_cancelled()
            self.session, self.session_key = session, key
        with self.lock:
            self.run_options = ort.RunOptions()
            self._check_cancelled()
        return self.session

    def _run_job(self, job_id, model, action, image_bytes, options):
        """在后台串行完成下载、推理和结果保存，所有结束状态都可被页面读取。"""
        try:
            folder = self._download(job_id, model)
            result = {"downloaded": True}
            if action != "download":
                session = self._load_session(job_id, model, folder, options["device"])
                self._check_cancelled()
                result = {"loaded": True}
                if action == "tagger":
                    self._progress(job_id, "preprocess")
                    with Image.open(io.BytesIO(image_bytes)) as image:
                        tensor = prepare_tagger_input(image, model)
                    self._check_cancelled()
                    self._progress(job_id, "inference")
                    # 清单中的 FP16 也保留 FP32 输入输出，精度转换由模型图内部完成。
                    prediction = session.run(None, {session.get_inputs()[0].name: tensor}, self.run_options)[0]
                    self._check_cancelled()
                    result = decode_tagger_output(prediction, folder / model["labelsFile"], model, options["thresholds"])
                elif action == "comic-lettering":
                    with Image.open(io.BytesIO(image_bytes)) as image:
                        cleaned, mask, details = session.rebuild(
                            image, options,
                            lambda stage, completed, total: self._progress(job_id, stage, completed, total),
                            self._check_cancelled, self.run_options,
                        )
                    self._check_cancelled()
                    self._progress(job_id, "encoding")
                    clean_output, mask_output = io.BytesIO(), io.BytesIO()
                    cleaned.save(clean_output, format="PNG")
                    mask.save(mask_output, format="PNG")
                    cleaned.close()
                    mask.close()
                    with self.lock:
                        self._check_cancelled()
                        self.jobs[job_id]["stage"] = "saving"
                    metadata = {"image_tool": "comic-lettering", "comic_lettering_source_hash": details["sourceHash"]}
                    saved = self.image_library.save_generated(clean_output.getvalue(), filename=f"comic_text_{job_id}.png", metadata=metadata)
                    saved_mask = self.image_library.save_generated(mask_output.getvalue(), filename=f"comic_mask_{job_id}.png",
                                                                  metadata={**metadata, "image_tool": "comic-lettering-mask"})
                    result = {**details, "image": saved, "mask": saved_mask}
                elif action == "upscale":
                    self._progress(job_id, "preprocess")
                    metadata = _inspect_image(io.BytesIO(image_bytes))["parameters"]
                    with Image.open(io.BytesIO(image_bytes)) as image:
                        enlarged = upscale_image(
                            image, model,
                            lambda tensor: session.run([model["outputName"]], {model["inputName"]: tensor}, self.run_options)[0],
                            lambda completed, total: self._progress(job_id, "inference", completed, total),
                            self._check_cancelled, options["scale"],
                        )
                    self._check_cancelled()
                    self._progress(job_id, "encoding")
                    output = io.BytesIO()
                    enlarged.save(output, format="PNG")
                    enlarged.close()
                    # 开始原子写入后不再接受取消，避免磁盘成功保存却向用户显示已取消。
                    with self.lock:
                        self._check_cancelled()
                        self.jobs[job_id]["stage"] = "saving"
                    metadata.update(image_tool="local-upscale", local_upscale_model=model["id"], local_upscale_factor=options["scale"])
                    saved = self.image_library.save_generated(output.getvalue(), filename=f"upscale_{job_id}.png", metadata=metadata)
                    result = {"image": saved}
            with self.lock:
                if self.jobs[job_id]["stage"] != "saving":
                    self._check_cancelled()
                self.jobs[job_id].update(status="completed", stage="completed", result=result)
        except InferenceCancelled:
            self._progress(job_id, "cancelled", status="cancelled")
        except Exception as exc:
            if self.cancel_event.is_set():
                self._progress(job_id, "cancelled", status="cancelled")
            else:
                stage = self.jobs[job_id]["stage"]
                code = exc.code if isinstance(exc, ExposableError) else (
                    "LOCAL_MODEL_DOWNLOAD_FAILED" if isinstance(exc, (requests.RequestException, zipfile.BadZipFile)) else
                    "LOCAL_STORAGE_FAILED" if isinstance(exc, OSError) else
                    "LOCAL_MODEL_LOAD_FAILED" if stage == "loading" else "LOCAL_INFERENCE_FAILED"
                )
                # 不把下载 URL、代理凭据、模型路径或底层驱动堆栈发给浏览器。
                logger.warning("event=local_inference_failed model=%s stage=%s error_type=%s code=%s", model["id"], stage, type(exc).__name__, code)
                self._progress(job_id, "failed", status="failed", error_code=code)
        finally:
            with self.lock:
                self.jobs[job_id]["finished_at"] = time.time()
                self.run_options = None
                self.active_id = None
