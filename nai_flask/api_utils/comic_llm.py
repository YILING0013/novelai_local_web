"""漫画编排的自定义模型配置和官方 SDK 调用。"""

from __future__ import annotations

import math
import logging
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .custom_errors import ExposableError


DEFAULT_LLM_SETTINGS = {
    "provider": "novelai", "baseUrl": "", "model": "",
    "storyModel": "", "extractModel": "", "formatModel": "",
    "outputMode": "schema", "tokenParameter": "max_completion_tokens",
    "maxTokens": 8192, "temperature": None, "timeoutSeconds": 180,
}
PROVIDER_URLS = {
    "openai": "https://api.openai.com/v1",
    "claude": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com",
    "deepseek": "https://api.deepseek.com",
}


class ComicLLMKeyStore:
    """单独保存用户选择记住的接口密钥，不进入项目数据或普通配置备份。"""

    def __init__(self, data_dir: str):
        """指定密钥文件所在的本地数据目录。

        Args:
            data_dir: 当前本地后端的数据目录。

        Returns:
            无返回值。
        """
        self.path = Path(data_dir).resolve() / "comic-llm-keys.json"
        self._lock = threading.RLock()

    def _read(self) -> dict[str, dict[str, str]]:
        """读取密钥表；文件损坏时明确报错，避免覆盖已有密钥。"""
        try:
            values = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            raise ExposableError("The saved AI API keys could not be read.", 500, "LLM_KEY_STORAGE_ERROR") from exc
        if not isinstance(values, dict) or any(
            not isinstance(endpoints, dict) or any(not isinstance(key, str) for key in endpoints.values())
            for endpoints in values.values()
        ):
            raise ExposableError("The saved AI API keys file is damaged.", 500, "LLM_KEY_STORAGE_ERROR")
        return values

    def get(self, provider: str, base_url: str) -> str:
        """读取与协议、地址匹配的已记住密钥。

        Args:
            provider: 接口协议。
            base_url: 已规范化的接口地址。

        Returns:
            已保存的密钥；未保存时返回空字符串。
        """
        with self._lock:
            return self._read().get(provider, {}).get(base_url, "")

    def update(self, changes: dict[tuple[str, str], str], removed_scopes: tuple[str, ...] = ()) -> None:
        """一次保存各接口的密钥改动，不保留含旧密钥的备份。

        Args:
            changes: 以配置标识、地址为键的密钥；空字符串表示清除。
            removed_scopes: 已删除配置的全部密钥分组。

        Returns:
            无返回值。
        """
        with self._lock:
            values = self._read()
            previous = json.dumps(values, sort_keys=True)
            for scope in removed_scopes:
                values.pop(scope, None)
            for (scope, base_url), api_key in changes.items():
                if api_key:
                    values.setdefault(scope, {})[base_url] = api_key
                else:
                    values.get(scope, {}).pop(base_url, None)
                    if not values.get(scope):
                        values.pop(scope, None)
            if json.dumps(values, sort_keys=True) == previous:
                return
            temp_path = None
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                # 临时文件在 Unix 上仅当前用户可读写；Windows 沿用数据目录权限。
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent,
                        prefix=".comic-llm-keys.", suffix=".tmp", delete=False) as file:
                    temp_path = Path(file.name)
                    json.dump(values, file, ensure_ascii=False)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temp_path, self.path)
            except OSError as exc:
                if temp_path is not None:
                    temp_path.unlink(missing_ok=True)
                raise ExposableError("The AI API key could not be saved or cleared locally.", 500, "LLM_KEY_STORAGE_ERROR") from exc


def validate_llm_settings(value: Any) -> dict[str, Any]:
    """校验并整理普通接口配置，API Key 由会话或专用密钥文件单独保管。

    Args:
        value: 用户填写的协议、地址、模型和生成参数。

    Returns:
        仅含已知配置字段的设置对象。
    """
    if not isinstance(value, dict):
        raise ExposableError("LLM settings must be an object.")
    settings = {key: value.get(key, default) for key, default in DEFAULT_LLM_SETTINGS.items()}
    if not isinstance(settings["provider"], str) or settings["provider"] not in {"novelai", *PROVIDER_URLS}:
        raise ExposableError("Select a supported AI API protocol.")
    for key in ("baseUrl", "model", "storyModel", "extractModel", "formatModel"):
        if not isinstance(settings[key], str):
            raise ExposableError("API address and model names must be text.")
        settings[key] = settings[key].strip()
    settings["baseUrl"] = settings["baseUrl"].rstrip("/")
    if settings["provider"] != "novelai":
        settings["baseUrl"] = settings["baseUrl"] or PROVIDER_URLS[settings["provider"]]
        try:
            address = urlsplit(settings["baseUrl"])
            address.port
        except ValueError as exc:
            raise ExposableError("Enter a valid API base URL and port.") from exc
        if (address.scheme not in {"http", "https"} or not address.hostname
                or address.username or address.password or address.query or address.fragment):
            raise ExposableError("Use an HTTP(S) API base URL without credentials, query or fragment.")
        if not settings["model"]:
            raise ExposableError("Enter the default model name supplied by your API service.")
    if not isinstance(settings["outputMode"], str) or settings["outputMode"] not in {"schema", "json", "prompt"}:
        raise ExposableError("Select a supported JSON output mode.")
    if settings["provider"] == "deepseek":
        settings["outputMode"] = "json"
        settings["tokenParameter"] = "max_tokens"
    if settings["provider"] == "claude" and settings["outputMode"] == "json":
        raise ExposableError("Claude supports JSON Schema or prompt-only output in this client.")
    if not isinstance(settings["tokenParameter"], str) or settings["tokenParameter"] not in {"max_tokens", "max_completion_tokens"}:
        raise ExposableError("Select a supported output token parameter.")
    if type(settings["maxTokens"]) is not int or settings["maxTokens"] <= 0:
        raise ExposableError("The output token limit must be a positive integer.")
    if type(settings["timeoutSeconds"]) is not int or not 1 <= settings["timeoutSeconds"] <= 3600:
        raise ExposableError("The request timeout must be between 1 and 3600 seconds.")
    temperature = settings["temperature"]
    if settings["provider"] == "claude" and temperature is not None:
        raise ExposableError("The current Claude SDK uses the model default temperature. Leave temperature empty.")
    if temperature is not None and (type(temperature) not in {int, float}
            or not math.isfinite(temperature) or not 0 <= temperature <= 2):
        raise ExposableError("Temperature must be empty or a number between 0 and 2.")
    return settings


def validate_llm_configuration(value: Any) -> dict[str, Any]:
    """校验 Provider 清单，保留各配置名称、启用状态和默认选择。

    Args:
        value: 不含密钥的 Provider 配置。

    Returns:
        可保存的 Provider 清单与默认配置标识。
    """
    if not isinstance(value, dict) or not isinstance(value.get("providers"), list):
        raise ExposableError("Provider 配置必须包含列表。")
    providers, ids, names = [], set(), set()
    for item in value["providers"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", item["id"]):
            raise ExposableError("Provider 标识无效。")
        name = item.get("name", "")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            raise ExposableError("请填写 1–80 字的 Provider 名称。")
        if item["id"] in ids or name.strip().casefold() in names:
            raise ExposableError("Provider 名称不能重复。")
        if not isinstance(item.get("enabled"), bool):
            raise ExposableError("Provider 启用状态无效。")
        settings = validate_llm_settings(item.get("settings"))
        if (item["id"] == "novelai") != (settings["provider"] == "novelai"):
            raise ExposableError("NovelAI 使用内置配置。")
        if item["id"] == "novelai" and not item["enabled"]:
            raise ExposableError("内置 NovelAI 配置不能停用。")
        ids.add(item["id"]); names.add(name.strip().casefold())
        providers.append({"id": item["id"], "name": name.strip(), "enabled": item["enabled"], "settings": settings})
    if "novelai" not in ids:
        raise ExposableError("请保留内置 NovelAI 配置。")
    active = value.get("activeProviderId")
    if not any(item["id"] == active and item["enabled"] for item in providers):
        raise ExposableError("请选择一个已启用的默认 Provider。")
    return {"activeProviderId": active, "providers": providers}


def llm_key_identity(provider: dict[str, Any]) -> tuple[str, str]:
    """取得密钥所属配置与接口地址，旧单接口配置继续使用原密钥。

    Args:
        provider: 已保存的 Provider 条目。

    Returns:
        密钥分组与接口地址。
    """
    settings = provider["settings"]
    scope = settings["provider"] if provider["id"] == "legacy" else f"{provider['id']}:{settings['provider']}"
    return scope, settings["baseUrl"]


def select_llm_provider(configuration: dict[str, Any], provider_id: str | None = None) -> dict[str, Any]:
    """选择指定或默认 Provider；不存在时明确报错。

    Args:
        configuration: 已校验的 Provider 清单。
        provider_id: 指定配置标识；省略时取默认配置。

    Returns:
        对应 Provider 条目。
    """
    selected = provider_id or configuration["activeProviderId"]
    provider = next((item for item in configuration["providers"] if item["id"] == selected), None)
    if provider is None:
        raise ExposableError("所选 Provider 已不存在，请重新选择。")
    return provider


def _object_schema(properties: dict[str, Any]) -> dict[str, Any]:
    """生成三个 SDK 都可使用的严格对象结构，空值用字段类型明确表达。"""
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


EXTRACTION_SCHEMA = _object_schema({
    "visualStyle": {"type": "string"},
    "characters": {"type": "array", "items": _object_schema({
        "id": {"type": "string"}, "name": {"type": "string"}, "appearance": {"type": "string"},
    })},
})
COMIC_SCHEMA = _object_schema({
    "summary": {"type": "string"},
    "sections": {"type": "array", "items": _object_schema({
        "globalPrompt": {"type": "string"}, "negativePrompt": {"type": "string"},
        "panels": {"type": "array", "items": _object_schema({
            "summary": {"type": "string"},
            "instances": {"type": "array", "items": _object_schema({
                "characterId": {"type": ["string", "null"]}, "prompt": {"type": "string"},
                "center": _object_schema({"x": {"type": "number"}, "y": {"type": "number"}}),
            })},
            "dialogues": {"type": "array", "items": _object_schema({
                "text": {"type": "string", "description": "台词原文；使用 sourceId 引用已有台词时可为空字符串。"},
                "sourceId": {"type": ["string", "null"], "description": "引用输入中的台词编号；直接填写 text 时为 null。"},
                "speakerId": {"type": ["string", "null"]},
                "type": {"type": "string", "enum": ["speech", "narration", "sfx"]},
                "direction": {"type": "string", "enum": ["horizontal", "vertical"]},
            })},
        })},
    })},
})


def complete_custom_llm(
    settings: dict[str, Any], api_key: str, body: dict[str, Any], schema: dict[str, Any] | None = None,
) -> str:
    """用所选官方 SDK 请求一次文本或 JSON，关闭自动重试并明确报告截断。

    Args:
        settings: 已校验的协议、地址与调用参数。
        api_key: 从当前会话或本地密钥文件取得的第三方密钥。
        body: 本阶段的模型名称和 system/user 消息。
        schema: 提取或分镜阶段的 JSON 结构；故事正文阶段为空。

    Returns:
        模型的完整正文；不包含推理块和工具调用。
    """
    if not api_key:
        raise ExposableError("Enter an API Key for this address in AI API settings.", 400, "LLM_KEY_REQUIRED")
    provider = settings["provider"]
    mode = settings["outputMode"]
    try:
        import httpx
        if provider in {"openai", "deepseek"}:
            import openai
            sdk_errors = (openai.APIError, httpx.HTTPError)
        elif provider == "claude":
            import anthropic
            sdk_errors = (anthropic.APIError, httpx.HTTPError)
        elif provider == "gemini":
            from google import genai
            from google.genai import errors, types
            import httpx2
            sdk_errors = (errors.APIError, httpx.HTTPError, httpx2.HTTPError)
        else:
            raise ExposableError("Select a custom AI API protocol.")
    except ImportError as exc:
        raise ExposableError("Install nai_flask/requirements.txt and restart the backend to use custom AI APIs.", 503, "LLM_SDK_MISSING") from exc

    # 部分 SDK 导入时会读取自身调试环境变量；在其初始化之后关闭请求正文和请求头日志。
    for name in ("openai", "anthropic", "httpx", "httpx2", "httpcore", "httpcore2", "google.genai"):
        logging.getLogger(name).setLevel(logging.WARNING)
    options = {"temperature": settings["temperature"]} if settings["temperature"] is not None else {}
    text, finish = "", ""
    try:
        if provider in {"openai", "deepseek"}:
            if schema is not None and mode == "schema":
                options["response_format"] = {"type": "json_schema", "json_schema": {
                    "name": "comic_response", "strict": True, "schema": schema,
                }}
            elif schema is not None and mode == "json":
                options["response_format"] = {"type": "json_object"}
            options[settings["tokenParameter"]] = settings["maxTokens"]
            with openai.OpenAI(api_key=api_key, base_url=settings["baseUrl"],
                               timeout=settings["timeoutSeconds"], max_retries=0) as client:
                response = client.chat.completions.create(model=body["model"], messages=body["messages"], **options)
            if response.choices:
                choice = response.choices[0]
                if choice.message.refusal:
                    raise ExposableError("The AI service declined this request. Revise the input and try again.", 502, "LLM_REFUSED")
                text, finish = choice.message.content or "", choice.finish_reason
        elif provider == "claude":
            if schema is not None and mode == "schema":
                options["output_config"] = {"format": {"type": "json_schema", "schema": schema}}
            with anthropic.Anthropic(api_key=api_key, base_url=settings["baseUrl"],
                                     timeout=settings["timeoutSeconds"], max_retries=0) as client:
                response = client.messages.create(
                    model=body["model"], max_tokens=settings["maxTokens"],
                    system="\n\n".join(message["content"] for message in body["messages"] if message["role"] == "system"),
                    messages=[message for message in body["messages"] if message["role"] != "system"], **options,
                )
            text = "".join(block.text for block in response.content if block.type == "text")
            finish = response.stop_reason
        else:
            if schema is not None and mode != "prompt":
                options["response_mime_type"] = "application/json"
                if mode == "schema":
                    options["response_json_schema"] = schema
            with genai.Client(api_key=api_key, vertexai=False, http_options=types.HttpOptions(
                base_url=settings["baseUrl"], timeout=settings["timeoutSeconds"] * 1000,
                retry_options=types.HttpRetryOptions(attempts=1),
            )) as client:
                response = client.models.generate_content(
                    model=body["model"],
                    contents=[types.Content(role="model" if message["role"] == "assistant" else "user",
                        parts=[types.Part.from_text(text=message["content"])])
                        for message in body["messages"] if message["role"] != "system"],
                    config=types.GenerateContentConfig(
                        system_instruction="\n\n".join(message["content"] for message in body["messages"] if message["role"] == "system"),
                        max_output_tokens=settings["maxTokens"], **options,
                    ),
                )
            if response.candidates:
                candidate = response.candidates[0]
                finish = candidate.finish_reason
                text = "".join(part.text for part in (candidate.content.parts if candidate.content else [])
                               if part.text and not part.thought)
    except sdk_errors as exc:
        # 上游错误正文和请求地址可能包含凭据，响应只公开状态与固定说明。
        status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
        if status in {401, 403}:
            raise ExposableError("The AI API rejected the key or model access. Check your API settings.", 502, "LLM_UNAUTHORIZED") from exc
        if status == 429:
            raise ExposableError("The AI API is rate limited or out of quota. Check the service account.", 429, "LLM_RATE_LIMITED") from exc
        if status in {400, 404, 422}:
            raise ExposableError("The AI API rejected the model, address or parameters. Check the output mode and token parameter.", 502, "LLM_REQUEST_REJECTED") from exc
        raise ExposableError("The AI API request failed or timed out. Check the service and connection.", 502, "LLM_REQUEST_FAILED") from exc
    if finish in {"length", "max_tokens", "MAX_TOKENS"}:
        raise ExposableError("The model output was truncated. Increase the output token limit and try again.", 502, "LLM_OUTPUT_TRUNCATED")
    if finish in {"refusal", "content_filter", "SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"}:
        raise ExposableError("The AI service declined this request. Revise the input and try again.", 502, "LLM_REFUSED")
    if not text.strip():
        raise ExposableError("The AI API returned no text. Check the model and output settings.", 502, "LLM_EMPTY_RESPONSE")
    return text
