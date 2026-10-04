"""验证不同身份的真实 TLS 配置、登录连续性和连接池隔离。"""

import hashlib
import json
import ssl
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

from api_utils.novelai_client import NovelAIClient, NovelAIUpstreamError, _NovelAITLSAdapter
from api_utils.account_change import CredentialChangeRejected, CredentialChangeUncertain
from api_utils.novelai_tls_profiles import create_tls_context, profile_ids


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.delenv("REQUESTS_CA_BUNDLE", raising=False)
    monkeypatch.delenv("CURL_CA_BUNDLE", raising=False)
    records = []
    closed = []
    original_close = requests.Session.close

    def send(session, request, **kwargs):
        adapter = session.get_adapter(request.url)
        records.append({
            "path": request.path_url,
            "authorization": request.headers.get("Authorization"),
            "ciphers": tuple(cipher["id"] for cipher in adapter._tls_context.get_ciphers()),
            "adapter": adapter,
            "session": session,
            "kwargs": kwargs,
        })
        response = requests.Response()
        response.status_code = 200
        payload = {"accessToken": "token-after-login"}
        if request.path_url == "/user/change-access-key":
            payload = {"accessToken": "token-after-change"}
        response._content = json.dumps(payload).encode()
        return response

    def close(session):
        closed.append(session)
        original_close(session)

    monkeypatch.setattr(requests.Session, "send", send)
    monkeypatch.setattr(requests.Session, "close", close)
    return records, closed


def test_same_token_keeps_fingerprint_and_different_tokens_do_not_share(transport):
    records, closed = transport
    client = NovelAIClient()
    client.account_snapshot("token-one")
    client.account_snapshot("token-two")
    client.account_snapshot("token-one")

    assert records[0]["ciphers"] == records[1]["ciphers"] == records[4]["ciphers"]
    assert records[2]["ciphers"] == records[3]["ciphers"]
    assert records[0]["ciphers"] != records[2]["ciphers"]
    assert len({id(record["session"]) for record in records}) == 6
    assert len({id(record["adapter"].poolmanager) for record in records}) == 6
    assert closed == [record["session"] for record in records]
    assert all(record["kwargs"]["verify"] is True for record in records)
    assert all(record["kwargs"]["allow_redirects"] is False for record in records)


def test_login_and_credential_change_keep_account_fingerprint(transport):
    records, _ = transport
    client = NovelAIClient()
    token = client.login("original-access-key")
    client.account_snapshot(token)
    new_token = client.change_access_key("original-access-key", "changed-access-key", token, None)
    client.put_keystore(new_token, "encrypted-keystore")
    client.login("changed-access-key")

    assert len({record["ciphers"] for record in records}) == 1
    assert records[0]["authorization"] is None
    assert records[1]["authorization"] == "Bearer token-after-login"
    assert records[4]["authorization"] == "Bearer token-after-change"


def test_profile_collisions_are_resolved_without_reusing_another_identity(monkeypatch, transport):
    monkeypatch.setattr("api_utils.novelai_client.profile_ids", lambda: ("tls-v1-0000", "tls-v1-0001"))
    records, _ = transport
    client = NovelAIClient()
    client.account_snapshot("first")
    client.account_snapshot("second")
    assert records[0]["ciphers"] != records[2]["ciphers"]
    with pytest.raises(NovelAIUpstreamError) as error:
        client.account_snapshot("third")
    assert error.value.code == "NOVELAI_TLS_PROFILES_EXHAUSTED"
    assert len(records) == 4


def test_rejected_account_change_does_not_rebind_target_account(monkeypatch, transport):
    records, _ = transport
    original_send = requests.Session.send

    def reject_change(session, request, **kwargs):
        response = original_send(session, request, **kwargs)
        if request.path_url == "/user/change-access-key":
            response.status_code = 409
        return response

    monkeypatch.setattr(requests.Session, "send", reject_change)
    client = NovelAIClient()
    client.account_snapshot("source-token")
    client.login("existing-target-key")
    target_fingerprint = records[-1]["ciphers"]
    assert target_fingerprint != records[0]["ciphers"]
    with pytest.raises(CredentialChangeRejected):
        client.change_access_key("source-key", "existing-target-key", "source-token", None)
    client.login("existing-target-key")
    assert records[-1]["ciphers"] == target_fingerprint


def test_concurrent_identities_have_distinct_profiles(transport):
    records, _ = transport
    client = NovelAIClient()
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(client.account_snapshot, [f"token-{index}" for index in range(12)]))
    fingerprints = {}
    for record in records:
        identity = record["authorization"]
        assert fingerprints.setdefault(identity, record["ciphers"]) == record["ciphers"]
    assert len(set(fingerprints.values())) == 12


def test_environment_proxy_is_preserved_without_netrc_authentication(monkeypatch, transport):
    proxy = "http://127.0.0.1:7890"
    monkeypatch.setattr(requests.utils, "get_environ_proxies", lambda url: {"https": proxy})
    monkeypatch.setattr(requests.sessions, "get_netrc_auth", lambda url: ("unwanted", "password"))
    records, _ = transport
    NovelAIClient().account_snapshot("original-token")
    assert records[0]["kwargs"]["proxies"] == {"https": proxy}
    assert records[0]["authorization"] == "Bearer original-token"


def test_profile_applies_to_direct_and_connect_pools_with_verified_ca():
    request = requests.Request("GET", "https://image.novelai.net/user/data").prepare()
    adapter = _NovelAITLSAdapter("tls-v1-0123")
    try:
        for proxies in ({}, {"https": "http://127.0.0.1:7890"}):
            pool = adapter.get_connection_with_tls_context(request, True, proxies=proxies)
            assert pool.conn_kw["ssl_context"] is adapter._tls_context
            adapter.cert_verify(pool, request.url, True, None)
            assert pool.ca_certs == requests.certs.where()
            assert pool.cert_reqs == "CERT_REQUIRED"
        assert adapter.max_retries.total == 0
    finally:
        adapter.close()


def test_custom_ca_bundle_remains_enabled(monkeypatch, transport):
    records, _ = transport
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "C:/certificates/local-ca.pem")
    NovelAIClient().account_snapshot("token-one")
    assert records[0]["kwargs"]["verify"] == "C:/certificates/local-ca.pem"


def test_all_profiles_are_distinct_secure_and_supported():
    signatures = set()
    for profile in profile_ids():
        context = create_tls_context(profile)
        assert context.minimum_version == ssl.TLSVersion.TLSv1_2
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname
        ciphers = context.get_ciphers()
        assert all(cipher["aead"] and cipher["strength_bits"] >= 128 for cipher in ciphers)
        signatures.add(tuple(cipher["id"] for cipher in ciphers))
    assert len(signatures) == 2048


def test_client_hello_offers_different_cipher_lists():
    cipher_lists = []
    for profile in ("tls-v1-0000", "tls-v1-0001"):
        outgoing = ssl.MemoryBIO()
        connection = create_tls_context(profile).wrap_bio(
            ssl.MemoryBIO(), outgoing, server_side=False, server_hostname="image.novelai.net",
        )
        with pytest.raises(ssl.SSLWantReadError):
            connection.do_handshake()
        hello = outgoing.read()
        # 跳过 record、handshake、版本、随机数和 session ID，读取真实发出的密码套件列表。
        assert hello[0] == 22 and hello[5] == 1
        offset = 5 + 4 + 2 + 32
        offset += 1 + hello[offset]
        length = int.from_bytes(hello[offset:offset + 2], "big")
        cipher_lists.append(hello[offset + 2:offset + 2 + length])
    assert cipher_lists[0] != cipher_lists[1]


def test_unsupported_profile_fails_before_request(monkeypatch, transport):
    records, _ = transport
    monkeypatch.setattr("api_utils.novelai_tls_profiles._OPTIONAL_CIPHERS", ("UNSUPPORTED-CIPHER",))
    monkeypatch.setattr("api_utils.novelai_client.profile_ids", lambda: ("tls-v1-0001",))
    with pytest.raises(NovelAIUpstreamError) as error:
        NovelAIClient().account_snapshot("token-one")
    assert error.value.code == "NOVELAI_TLS_UNSUPPORTED"
    assert records == []


def test_app_restarts_preserve_colliding_identities_in_reverse_order(tmp_path, monkeypatch, transport):
    from app import create_app

    monkeypatch.setattr("api_utils.novelai_client.profile_ids", lambda: ("tls-v1-0000", "tls-v1-0001"))
    identities = [
        f"collision-token-{index}" for index in range(20)
        if int.from_bytes(hashlib.sha256(f"collision-token-{index}".encode()).digest()[:4], "big") % 2 == 0
    ][:2]
    records, _ = transport
    config = {"TESTING": True, "DATA_DIR": str(tmp_path / "custom-data")}
    client = create_app(config).extensions["novelai_client"]
    for identity in identities:
        client.account_snapshot(identity)
    expected = {record["authorization"]: record["ciphers"] for record in records}
    assert len(set(expected.values())) == 2

    path = tmp_path / "custom-data" / "novelai-tls-bindings.json"
    saved = path.read_text(encoding="utf-8")
    assert all(identity not in saved for identity in identities)
    assert set(json.loads(saved)["bindings"]) == {hashlib.sha256(identity.encode()).hexdigest() for identity in identities}
    records.clear()
    restarted = create_app(config).extensions["novelai_client"]
    for identity in reversed(identities):
        restarted.account_snapshot(identity)
    assert all(record["ciphers"] == expected[record["authorization"]] for record in records)
    with pytest.raises(NovelAIUpstreamError, match="capacity is exhausted"):
        restarted.account_snapshot("third-identity")
    assert path.read_text(encoding="utf-8") == saved


def test_login_and_changed_credentials_persist_all_aliases(tmp_path, transport):
    records, _ = transport
    path = tmp_path / "bindings.json"
    client = NovelAIClient(tls_bindings_path=path)
    token = client.login("original-access-key")
    fingerprint = records[0]["ciphers"]
    new_token = client.change_access_key("original-access-key", "changed-access-key", token, None)
    bindings = json.loads(path.read_text(encoding="utf-8"))["bindings"]
    credentials = ["original-access-key", "changed-access-key", token, new_token]
    assert set(bindings) == {hashlib.sha256(value.encode()).hexdigest() for value in credentials}
    assert len(set(bindings.values())) == 1

    records.clear()
    restarted = NovelAIClient(tls_bindings_path=path)
    restarted.account_snapshot(new_token)
    restarted.login("changed-access-key")
    restarted.login("original-access-key")
    assert all(record["ciphers"] == fingerprint for record in records)
    assert all(value not in path.read_text(encoding="utf-8") for value in credentials)


def test_password_login_preserves_preexisting_token_binding_after_restart(tmp_path, transport):
    records, _ = transport
    path = tmp_path / "bindings.json"
    client = NovelAIClient(tls_bindings_path=path)
    client.account_snapshot("token-after-login")
    fingerprint = records[0]["ciphers"]
    client.login("access-key-first-seen-later")
    records.clear()
    NovelAIClient(tls_bindings_path=path).login("access-key-first-seen-later")
    assert records[0]["ciphers"] == fingerprint


def test_concurrent_allocations_are_all_saved(tmp_path, transport):
    records, _ = transport
    path = tmp_path / "bindings.json"
    client = NovelAIClient(tls_bindings_path=path)
    identities = [f"concurrent-token-{index}" for index in range(12)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(client.account_snapshot, identities))
    expected = {record["authorization"]: record["ciphers"] for record in records}
    assert len(set(expected.values())) == len(identities)
    records.clear()
    restarted = NovelAIClient(tls_bindings_path=path)
    for identity in reversed(identities):
        restarted.account_snapshot(identity)
    assert all(record["ciphers"] == expected[record["authorization"]] for record in records)


@pytest.mark.parametrize("content", [
    "",
    "{",
    json.dumps({"schema_version": 2, "bindings": {}}),
    json.dumps({"schema_version": 1, "bindings": {"invalid-digest": "tls-v1-0000"}}),
    json.dumps({"schema_version": 1, "bindings": {"a" * 64: "unknown-profile"}}),
])
def test_damaged_bindings_fail_without_resetting_file(tmp_path, content):
    path = tmp_path / "bindings.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(RuntimeError, match="TLS"):
        NovelAIClient(tls_bindings_path=path)
    assert path.read_text(encoding="utf-8") == content


def test_failed_save_keeps_old_file_and_blocks_request_until_retry(tmp_path, monkeypatch, transport):
    records, _ = transport
    path = tmp_path / "bindings.json"
    client = NovelAIClient(tls_bindings_path=path)
    client.account_snapshot("known-token")
    saved = path.read_bytes()
    records.clear()

    def deny_replace(*args):
        raise PermissionError("simulated write failure")

    with monkeypatch.context() as patch:
        patch.setattr("api_utils.novelai_client.os.replace", deny_replace)
        with pytest.raises(NovelAIUpstreamError) as error:
            client.account_snapshot("new-token")
        assert error.value.code == "LOCAL_TLS_BINDINGS_WRITE_FAILED"
        assert records == []
        assert path.read_bytes() == saved
        assert hashlib.sha256(b"new-token").digest() not in client._tls_bindings
    client.account_snapshot("new-token")
    assert len(records) == 2
    assert hashlib.sha256(b"new-token").hexdigest() in json.loads(path.read_text())["bindings"]


@pytest.mark.parametrize("status", [200, 500])
def test_mutation_save_failure_stays_uncertain_and_can_recover_binding(tmp_path, monkeypatch, transport, status):
    records, _ = transport
    path = tmp_path / "bindings.json"
    client = NovelAIClient(tls_bindings_path=path)
    token = client.login("original-key")
    fingerprint = records[0]["ciphers"]
    original_send = requests.Session.send

    def send(session, request, **kwargs):
        response = original_send(session, request, **kwargs)
        if request.path_url == "/user/change-access-key":
            response.status_code = status
        return response

    def deny_replace(*args):
        raise PermissionError("simulated write failure")

    monkeypatch.setattr(requests.Session, "send", send)
    with monkeypatch.context() as patch:
        patch.setattr("api_utils.novelai_client.os.replace", deny_replace)
        with pytest.raises(CredentialChangeUncertain, match="TLS"):
            client.change_access_key("original-key", "target-key", token, None)
    assert len([record for record in records if record["path"] == "/user/change-access-key"]) == 1
    restarted = NovelAIClient(tls_bindings_path=path)
    restarted.inherit_tls_profile("original-key", "target-key")
    records.clear()
    restarted.login("target-key")
    assert records[0]["ciphers"] == fingerprint


def test_rejected_change_leaves_persisted_target_unchanged(tmp_path, monkeypatch, transport):
    records, _ = transport
    path = tmp_path / "bindings.json"
    client = NovelAIClient(tls_bindings_path=path)
    client.account_snapshot("source-token")
    client.login("target-key")
    target_fingerprint = records[-1]["ciphers"]
    saved = path.read_bytes()
    original_send = requests.Session.send

    def reject(session, request, **kwargs):
        response = original_send(session, request, **kwargs)
        if request.path_url == "/user/change-access-key":
            response.status_code = 409
        return response

    monkeypatch.setattr(requests.Session, "send", reject)
    with pytest.raises(CredentialChangeRejected):
        client.change_access_key("source-key", "target-key", "source-token", None)
    assert path.read_bytes() == saved
    records.clear()
    NovelAIClient(tls_bindings_path=path).login("target-key")
    assert records[0]["ciphers"] == target_fingerprint
