#!/usr/bin/env python3
"""检查本地开源版是否重新带入已移除功能或凭据。"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "next_nai_web"
BACKEND = ROOT / "nai_flask"
TEXT_SUFFIXES = {".js", ".jsx", ".mjs", ".json", ".py", ".toml", ".yaml", ".yml"}
SKIPPED_PARTS = {".git", ".next", ".venv", "node_modules", "__pycache__", ".pytest_cache"}
FRONTEND_FORBIDDEN = {
    "Redis": re.compile(r"\bredis\b", re.IGNORECASE),
    "Turnstile": re.compile(r"turnstile", re.IGNORECASE),
    "reCAPTCHA": re.compile(r"recaptcha", re.IGNORECASE),
    "反调试依赖": re.compile(r"disable-devtool|anti[-_]?debug", re.IGNORECASE),
    "安全媒体运行时": re.compile(r"secure[_-]?media|wasm[-_]?security|secure[-_]?runtime", re.IGNORECASE),
    "非 NovelAI 模型": re.compile(r"\b(?:krea(?:2|muse)?|gemini|wan(?:2(?:\.2)?)?)\b", re.IGNORECASE),
    "其它生成器元数据": re.compile(
        r"stable\s+diffusion|\ba1111\b|automatic1111|parsewebuimetadata",
        re.IGNORECASE,
    ),
    "第三方远程图片": re.compile(r"t\.alcy\.cc|placehold\.co", re.IGNORECASE),
    "旧站点 API": re.compile(
        r"(?:api|nai)\.idlecloud\.cc|sparxie\.net|api\.novelai\.net|"
        r"/api/(?:google-login|admin|account/redemption)",
        re.IGNORECASE,
    ),
}
BACKEND_FORBIDDEN = {
    "Redis": re.compile(r"\bredis\b", re.IGNORECASE),
    "旧站点 API": re.compile(
        r"(?:api|nai)\.idlecloud\.cc|sparxie\.net|api\.novelai\.net",
        re.IGNORECASE,
    ),
}
LONG_PAT = re.compile(r"pst-[A-Za-z0-9._~-]{48,}")


def iter_source_files(root: Path):
    """枚举需要进入发布扫描的小型文本源码。"""

    for directory, directories, filenames in os.walk(root):
        directories[:] = [
            name for name in directories
            if name not in SKIPPED_PARTS and name != "out"
        ]
        for filename in filenames:
            path = Path(directory) / filename
            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            relative_parts = path.relative_to(root).parts
            if relative_parts[:1] == ("public",) and path.name in {
                "metadata.json",
                "t5_tokenizer.json",
            }:
                continue
            if "tests" in relative_parts or ".test." in path.name:
                continue
            if path.stat().st_size > 5 * 1024 * 1024:
                continue
            yield path


def scan_patterns(root: Path, patterns: dict[str, re.Pattern[str]], failures: set[str]) -> None:
    """扫描一个源码树，只报告类别和路径，不回显可能敏感的原文。"""

    for path in iter_source_files(root):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for label, pattern in patterns.items():
            if pattern.search(text):
                failures.add(f"{label}: {path.relative_to(ROOT)}")


def scan_built_javascript(failures: set[str]) -> None:
    """扫描 Next 静态导出的运行时 JavaScript。"""

    static_root = FRONTEND / "out" / "_next" / "static"
    if not static_root.is_dir():
        failures.add("静态构建缺失: next_nai_web/out/_next/static")
        return
    for path in static_root.rglob("*.js"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for label, pattern in FRONTEND_FORBIDDEN.items():
            if pattern.search(text):
                failures.add(f"构建产物含{label}: {path.relative_to(ROOT)}")


def scan_credentials(failures: set[str]) -> None:
    """搜索可能误提交的长 Persistent Token，但不输出其内容。"""

    allowed_suffixes = TEXT_SUFFIXES | {".md", ".txt", ".bat", ".ps1"}
    for directory, directories, filenames in os.walk(ROOT):
        directories[:] = [
            name for name in directories
            if name not in SKIPPED_PARTS and name != "out"
        ]
        for filename in filenames:
            path = Path(directory) / filename
            if path.suffix.lower() not in allowed_suffixes:
                continue
            if path.stat().st_size > 5 * 1024 * 1024:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if LONG_PAT.search(text):
                failures.add(f"疑似 Persistent Token: {path.relative_to(ROOT)}")


def main() -> int:
    """执行源码、构建产物、仓库边界与凭据扫描。"""

    failures: set[str] = set()
    for required in (FRONTEND, BACKEND):
        if not required.is_dir():
            failures.add(f"目录缺失: {required.relative_to(ROOT)}")
    for child_git in (FRONTEND / ".git", BACKEND / ".git"):
        if child_git.exists():
            failures.add(f"不允许嵌套 Git: {child_git.relative_to(ROOT)}")

    scan_patterns(FRONTEND, FRONTEND_FORBIDDEN, failures)
    scan_patterns(BACKEND, BACKEND_FORBIDDEN, failures)
    scan_built_javascript(failures)
    scan_credentials(failures)

    if failures:
        print("发布扫描失败：", file=sys.stderr)
        for failure in sorted(failures):
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("发布扫描通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
