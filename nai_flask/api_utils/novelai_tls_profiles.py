"""账号固定 TLS 配置：只使用前向保密和 AEAD 套件，不降低 TLS 安全版本。"""

import ssl

from urllib3.util.ssl_ import create_urllib3_context


# 保留两种证书类型的基础套件；其余安全套件按固定编号选择，顺序和编号不能随意改动。
# TLS 1.3 套件由 OpenSSL 管理；ClientHello 仍包含这些 TLS 1.2 套件，因此指纹可区分。
_BASE_CIPHERS = (
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256",
)
_OPTIONAL_CIPHERS = (
    "ECDHE-ECDSA-AES256-GCM-SHA384",
    "ECDHE-RSA-AES256-GCM-SHA384",
    "ECDHE-ECDSA-CHACHA20-POLY1305",
    "ECDHE-RSA-CHACHA20-POLY1305",
    "DHE-RSA-AES128-GCM-SHA256",
    "DHE-RSA-AES256-GCM-SHA384",
    "DHE-RSA-CHACHA20-POLY1305",
    "ECDHE-ECDSA-AES128-CCM",
    "ECDHE-ECDSA-AES256-CCM",
    "DHE-RSA-AES128-CCM",
    "DHE-RSA-AES256-CCM",
)
_PROFILE_IDS = tuple(f"tls-v1-{index:04d}" for index in range(1 << len(_OPTIONAL_CIPHERS)))
_PROFILE_ID_SET = frozenset(_PROFILE_IDS)


def profile_ids():
    """
    返回可分配的固定版本 TLS 配置编号，供本地身份分配时检查独占关系。

    Returns:
        tuple[str, ...]: 按稳定顺序排列的 2048 个配置编号。
    """
    return _PROFILE_IDS


def validate_tls_profile_id(value):
    """
    校验账号保存的 TLS 配置编号，不为缺失或未知配置选择默认值。

    Args:
        value: 账号的 TLS 配置编号。

    Returns:
        str: 已验证的原始编号。
    """
    if not isinstance(value, str) or value not in _PROFILE_ID_SET:
        raise ValueError("本地身份缺少有效的 TLS Profile。")
    return value


def create_tls_context(profile_id):
    """
    为一个客户端建立独立 TLS 上下文，并验证当前 OpenSSL 完整支持指定套件。

    Args:
        profile_id: 已分配给账号的固定配置编号。

    Returns:
        ssl.SSLContext: 启用证书验证、最低 TLS 1.2 的独立上下文。
    """
    profile_id = validate_tls_profile_id(profile_id)
    mask = int(profile_id.removeprefix("tls-v1-"))
    ciphers = _BASE_CIPHERS + tuple(
        cipher for index, cipher in enumerate(_OPTIONAL_CIPHERS) if mask & (1 << index)
    )
    context = create_urllib3_context(
        ciphers=":".join(ciphers), ssl_minimum_version=ssl.TLSVersion.TLSv1_2,
    )
    actual = {cipher["name"] for cipher in context.get_ciphers() if cipher["protocol"] != "TLSv1.3"}
    if actual != set(ciphers):
        # OpenSSL 会静默忽略不支持的套件，必须阻止不同 Profile 退化成相同指纹。
        raise ValueError("当前 OpenSSL 不完整支持账号 TLS Profile，请先检查部署环境。")
    # 默认 CA 由 Requests 的 verify=True 在实际建连时加载。此处重复加载会增加
    # 新客户端成本；不能为省加载而关闭证书/主机名校验或覆盖 cert_verify。
    return context
