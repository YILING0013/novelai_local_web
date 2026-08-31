# -*- coding: utf-8 -*-
"""本地 API 可公开的参数校验异常。"""

import re


_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_PRIVATE_TEXT_RE = re.compile(
    r"(?i)(?:traceback\s*\(most recent call last\)|"
    r"\b(?:authorization|password|token|secret|cookie)\s*[:=]|"
    r"\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+)"
)


def _safe_message(message):
    """只允许固定英文校验提示进入浏览器响应。"""

    if (
        not isinstance(message, str)
        or not message.strip()
        or _CJK_RE.search(message)
        or _PRIVATE_TEXT_RE.search(message)
    ):
        return "The request is invalid."
    return message

class ExposableError(Exception):
    """
    可暴露给前端的错误异常类。
    仅保留已确认安全的英文信息；中文动态错误会降级为通用英文错误。
    """
    def __init__(self, message, status_code=400, code=None):
        """
        初始化公开错误。

        Args:
            message (str): 已确认可公开的英文错误文本。
            status_code (int): 对应的 HTTP 状态码。
            code (str | None): 可选的稳定业务错误码，供客户端本地化展示。

        Returns:
            None.
        """
        safe_message = _safe_message(message)
        super().__init__(safe_message)
        self.message = safe_message
        self.status_code = status_code
        self.code = code
