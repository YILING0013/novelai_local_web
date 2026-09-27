# -*- coding: utf-8 -*-
"""本地 JSON 数据的原子读取与写入。"""

from __future__ import annotations

import copy
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable


class LocalStoreError(Exception):
    """表示本地 JSON 文件不可读取或不可写入。"""


class LocalJsonStore:
    """将固定名称的数据集合保存在本地 JSON 文件中。"""

    DEFAULTS = {
        "settings": {},
        "random-prompts": {
            "categories": [],
            "collections": [],
            "enabled": True,
        },
        "notes": [],
        "artist-threads": [],
        "image-references": [],
    }
    DEFAULT_MAX_BYTES = 10 * 1024 * 1024
    SCHEMA_VERSION = 1

    def __init__(
        self,
        data_dir: str | os.PathLike[str],
        max_bytes: int = DEFAULT_MAX_BYTES,
    ) -> None:
        """
        初始化本地 JSON 存储。

        Args:
            data_dir: 仅用于本地运行数据的目录。
            max_bytes: 每个 JSON 文件允许读取或写入的最大字节数。
        """

        self.data_dir = Path(data_dir).expanduser().resolve()
        self.max_bytes = int(max_bytes)
        if self.max_bytes <= 0:
            raise ValueError("max_bytes must be positive.")
        # 不同数据类别互不阻塞，同一文件的读改写仍保持串行。
        self._locks = {name: threading.RLock() for name in self.DEFAULTS}

    def _path(self, name: str) -> Path:
        """把固定集合名映射为数据文件，拒绝任意路径输入。"""

        if name not in self.DEFAULTS:
            raise ValueError("Unknown local data collection.")
        return self.data_dir / f"{name}.json"

    def _validate(self, name: str, value: Any) -> None:
        """校验三个固定集合的顶层 JSON 结构。"""

        expected_type = dict if name in {"settings", "random-prompts"} else list
        if not isinstance(value, expected_type):
            expected_name = "object" if expected_type is dict else "array"
            raise LocalStoreError(f"Local data file '{name}' must contain a JSON {expected_name}.")
        if name == "random-prompts" and (
            set(value) != {"categories", "collections", "enabled"}
            or not isinstance(value["categories"], list)
            or not isinstance(value["collections"], list)
            or not isinstance(value["enabled"], bool)
        ):
            raise LocalStoreError("Local data file 'random-prompts' has an invalid schema.")

    def _reject_credentials(self, value: Any, field_name: str | None = None) -> None:
        """递归拒绝敏感字段名和实际 PAT、JWT、access key 或 Authorization 值。"""

        if field_name is not None:
            normalized = re.sub(r"[^a-z0-9]+", "_", field_name.lower()).strip("_")
            compact = normalized.replace("_", "")
            sensitive_names = {
                "authorization",
                "password",
                "passwd",
                "persistent_token",
                "access_token",
                "access_key",
                "api_key",
                "cookie",
                "secret",
            }
            compact_sensitive_suffixes = (
                "password",
                "passwd",
                "persistenttoken",
                "accesstoken",
                "accesskey",
                "apikey",
                "authorization",
                "cookie",
                "secret",
            )
            if (
                normalized in sensitive_names
                or normalized.endswith("_password")
                or normalized.endswith("_access_token")
                or normalized.endswith("_access_key")
                or compact.endswith(compact_sensitive_suffixes)
            ):
                raise LocalStoreError("Credentials are not allowed in local data files.")

        if isinstance(value, dict):
            for key, nested in value.items():
                self._reject_credentials(nested, str(key))
            return
        if isinstance(value, list):
            for nested in value:
                self._reject_credentials(nested)
            return
        if not isinstance(value, str):
            return

        text = value.strip()
        credential_patterns = (
            r"(?<![A-Za-z0-9._~-])pst-[A-Za-z0-9._~-]{16,}(?![A-Za-z0-9._~-])",
            r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])",
            r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{64}(?![A-Za-z0-9_-])",
            r"(?i)(?:Bearer|Basic)\s+[A-Za-z0-9+/=_~.-]{8,}",
        )
        if any(re.search(pattern, text) for pattern in credential_patterns):
            raise LocalStoreError("Credentials are not allowed in local data files.")

    def _read_bytes(self, path: Path, name: str) -> bytes:
        """在分配完整文件内容前执行明确的字节上限检查。"""

        try:
            if path.stat().st_size > self.max_bytes:
                raise LocalStoreError(f"Local data file '{name}' is too large.")
            return path.read_bytes()
        except LocalStoreError:
            raise
        except OSError as exc:
            raise LocalStoreError(f"Local data file '{name}' could not be read.") from exc

    def _decode(self, name: str, content: bytes) -> Any:
        """解码并校验一个已经受大小限制的 JSON 文件。"""

        try:
            envelope = json.loads(content.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise LocalStoreError(f"Local data file '{name}' is damaged.") from exc
        if (
            not isinstance(envelope, dict)
            or set(envelope) != {"schema_version", "data"}
            or envelope.get("schema_version") != self.SCHEMA_VERSION
        ):
            raise LocalStoreError(f"Local data file '{name}' has an unsupported schema.")
        value = envelope["data"]
        self._validate(name, value)
        # 手工写入或旧文件也必须经过与新写入相同的凭据边界。
        self._reject_credentials(value)
        return value

    def _atomic_write(self, path: Path, content: bytes, name: str) -> None:
        """在目标同目录完成 fsync 后原子替换一个明确文件。"""

        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "wb",
                dir=self.data_dir,
                prefix=f".{name}.",
                suffix=".tmp",
                delete=False,
            ) as file:
                temp_path = Path(file.name)
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temp_path, path)
        except OSError as exc:
            if temp_path is not None:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise LocalStoreError(f"Local data file '{name}' could not be written.") from exc

    def read(self, name: str) -> Any:
        """
        读取一个固定本地集合。

        Args:
            name: settings、random-prompts 或 notes。

        Returns:
            JSON 可序列化的本地数据；文件不存在时返回该集合的空值。
        """

        path = self._path(name)
        with self._locks[name]:
            if not path.exists():
                return copy.deepcopy(self.DEFAULTS[name])
            return self._decode(name, self._read_bytes(path, name))

    def write(self, name: str, value: Any) -> Any:
        """
        使用同目录临时文件和原子替换保存一个固定本地集合。

        Args:
            name: settings、random-prompts 或 notes。
            value: 要完整保存的 JSON 数据。

        Returns:
            已保存数据的深拷贝。
        """

        path = self._path(name)
        self._validate(name, value)
        self._reject_credentials(value)
        with self._locks[name]:
            try:
                self.data_dir.mkdir(parents=True, exist_ok=True)
                serialized = (
                    json.dumps(
                        {"schema_version": self.SCHEMA_VERSION, "data": value},
                        ensure_ascii=False,
                        indent=2,
                    ) + "\n"
                ).encode("utf-8")
            except (OSError, TypeError, ValueError) as exc:
                raise LocalStoreError(f"Local data file '{name}' could not be prepared.") from exc
            if len(serialized) > self.max_bytes:
                raise LocalStoreError(f"Local data file '{name}' is too large.")

            if path.exists():
                previous = self._read_bytes(path, name)
                # 只有确认当前文件仍是 last-good 后才允许覆盖并生成备份。
                self._decode(name, previous)
                backup_path = path.with_suffix(f"{path.suffix}.bak")
                self._atomic_write(backup_path, previous, f"{name}.backup")
            self._atomic_write(path, serialized, name)
        return copy.deepcopy(value)

    def mutate(self, name: str, mutator: Callable[[Any], Any]) -> Any:
        """
        在同一集合锁内完成一次读取、修改和原子写入。

        Args:
            name: settings、random-prompts 或 notes。
            mutator: 接收当前数据深拷贝并返回完整新数据的同步函数。

        Returns:
            已原子保存的新数据深拷贝。
        """

        path = self._path(name)
        with self._locks[name]:
            if path.exists():
                current = self._decode(name, self._read_bytes(path, name))
            else:
                current = copy.deepcopy(self.DEFAULTS[name])
            updated = mutator(copy.deepcopy(current))
            return self.write(name, updated)
