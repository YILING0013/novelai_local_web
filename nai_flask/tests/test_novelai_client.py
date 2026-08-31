import base64
import io
import zipfile

import pytest
import requests
from PIL import Image

from api_utils.account_change import CredentialChangeRejected, CredentialChangeUncertain
from api_utils.novelai_client import NovelAIClient, NovelAIUpstreamError
from conftest import PNG_BASE64


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b"", headers=None):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def _image_bytes(image_format="PNG"):
    """生成官方结果解析测试使用的真实单帧图像。"""

    output = io.BytesIO()
    Image.new("RGB", (2, 2), (90, 80, 70)).save(output, format=image_format)
    return output.getvalue()


def test_generate_and_upscale_require_json_and_never_follow_redirects():
    calls = []
    encoded = PNG_BASE64

    def request_func(method, url, **kwargs):
        calls.append((method, url, kwargs))
        status = 201 if url.endswith("/generate-image") else 200
        return FakeResponse(status, {"images": [{"image": encoded, "seed": 7, "index": 0}]})

    client = NovelAIClient(request_func=request_func)
    generated = client.generate_image("pst-test", {"parameters": {"n_samples": 1}}, "cid")
    upscaled = client.upscale_image("pst-test", {"image": encoded}, "cid-2")

    assert generated[0]["data"] == encoded
    assert generated[0]["seed"] == 7
    assert upscaled[0]["mime_type"] == "image/png"
    for _, url, kwargs in calls:
        assert url.startswith("https://image.novelai.net/")
        assert kwargs["headers"]["Accept"] == "application/json"
        assert kwargs["headers"]["Authorization"] == "Bearer pst-test"
        assert kwargs["allow_redirects"] is False


def test_redirect_and_unauthorized_are_fail_closed():
    redirect_client = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(307, headers={"Location": "https://attacker.example"})
    )
    with pytest.raises(NovelAIUpstreamError, match="unexpected redirect") as redirect:
        redirect_client.account_snapshot("pst-test")
    assert redirect.value.code == "NOVELAI_REDIRECT_REJECTED"

    unauthorized_client = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(401)
    )
    with pytest.raises(NovelAIUpstreamError) as unauthorized:
        unauthorized_client.account_snapshot("pst-test")
    assert unauthorized.value.status_code == 401


def test_augment_accepts_official_binary_archive():
    webp_bytes = _image_bytes("WEBP")
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w") as archive:
        archive.writestr("image.webp", webp_bytes)
    client = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(
            200,
            content=archive_bytes.getvalue(),
            headers={"Content-Type": "application/zip"},
        )
    )

    image = client.augment_image("pst-test", {"req_type": "lineart"}, "cid")
    assert image["data"] == base64.b64encode(webp_bytes).decode("ascii")
    assert image["mime_type"] == "image/webp"


@pytest.mark.parametrize(
    "response",
    [
        FakeResponse(201, {"images": [{
            "image": base64.b64encode(b"not-an-image").decode("ascii"),
        }]}),
        FakeResponse(201, {"images": [{"image": "%%%"}]}),
    ],
)
def test_json_image_results_reject_corrupted_content(response):
    client = NovelAIClient(request_func=lambda *args, **kwargs: response)
    with pytest.raises(NovelAIUpstreamError) as invalid:
        client.generate_image("pst-test", {"parameters": {"n_samples": 1}}, "cid")
    assert invalid.value.code == "NOVELAI_INVALID_IMAGE"
    assert invalid.value.status_code == 502


def test_binary_image_archive_rejects_corruption_and_multiple_files():
    corrupted_archive = io.BytesIO()
    with zipfile.ZipFile(corrupted_archive, "w") as archive:
        archive.writestr("image.png", b"not-an-image")
    corrupted = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(
            201,
            content=corrupted_archive.getvalue(),
            headers={"Content-Type": "application/zip"},
        )
    )
    with pytest.raises(NovelAIUpstreamError) as invalid:
        corrupted.augment_image("pst-test", {"req_type": "lineart"}, "cid")
    assert invalid.value.code == "NOVELAI_INVALID_IMAGE"

    multiple_archive = io.BytesIO()
    with zipfile.ZipFile(multiple_archive, "w") as archive:
        archive.writestr("first.png", _image_bytes())
        archive.writestr("second.png", _image_bytes())
    multiple = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(
            201,
            content=multiple_archive.getvalue(),
            headers={"Content-Type": "application/zip"},
        )
    )
    with pytest.raises(NovelAIUpstreamError) as invalid_archive:
        multiple.augment_image("pst-test", {"req_type": "lineart"}, "cid")
    assert invalid_archive.value.code == "NOVELAI_INVALID_IMAGE"


def test_login_maps_only_structured_official_captcha_code():
    client = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(
            403,
            {"code": "CAPTCHA_REQUIRED", "message": "sensitive upstream body"},
        )
    )
    with pytest.raises(NovelAIUpstreamError) as required:
        client.login("derived-access-key")
    assert required.value.code == "OFFICIAL_CAPTCHA_REQUIRED"
    assert "sensitive" not in required.value.message


def test_account_snapshot_uses_information_and_subscription_paths():
    urls = []

    def request_func(method, url, **kwargs):
        urls.append(url)
        return FakeResponse(200, {"path": url.rsplit("/", 1)[-1]})

    snapshot = NovelAIClient(request_func=request_func).account_snapshot("pst-test")
    assert urls == [
        "https://image.novelai.net/user/information",
        "https://image.novelai.net/user/subscription",
    ]
    assert snapshot["information"]["path"] == "information"
    assert snapshot["subscription"]["path"] == "subscription"


def test_keystore_missing_requires_user_data_confirmation():
    calls = []
    responses = iter([
        FakeResponse(200, {"keystore": None}),
        FakeResponse(200, {"keystore": None}),
    ])

    def request_func(method, url, **kwargs):
        calls.append(url)
        return next(responses)

    record = NovelAIClient(request_func=request_func).get_keystore_record("pst-test")
    assert record.payload is None
    assert record.confirmed_missing is True
    assert calls == [
        "https://image.novelai.net/user/keystore",
        "https://image.novelai.net/user/data",
    ]


def test_keystore_user_data_recovers_payload_and_change_index():
    responses = iter([
        FakeResponse(200, {"statusCode": 404, "keystore": None}),
        FakeResponse(200, {"keystore": {"keystore": "encoded", "changeIndex": 7}}),
    ])
    client = NovelAIClient(request_func=lambda *args, **kwargs: next(responses))
    record = client.get_keystore_record("pst-test")
    assert record.payload == "encoded"
    assert record.change_index == 7
    assert record.confirmed_missing is False


def test_account_mutation_has_strict_certain_and_uncertain_errors():
    encoded_success = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(200, {"accessToken": "new-token"})
    )
    assert encoded_success.change_access_key("old-key", "new-key", "old-token", None) == "new-token"

    rejected = NovelAIClient(request_func=lambda *args, **kwargs: FakeResponse(400, {}))
    with pytest.raises(CredentialChangeRejected):
        rejected.change_access_key("old-key", "new-key", "old-token", None)

    server_failed = NovelAIClient(request_func=lambda *args, **kwargs: FakeResponse(500, {}))
    with pytest.raises(CredentialChangeUncertain):
        server_failed.put_keystore("new-token", "encoded")

    timed_out = NovelAIClient(
        request_func=lambda *args, **kwargs: (_ for _ in ()).throw(requests.Timeout())
    )
    with pytest.raises(CredentialChangeUncertain):
        timed_out.change_access_key("old-key", "new-key", "old-token", "new@example.com")

    invalid_success = NovelAIClient(request_func=lambda *args, **kwargs: FakeResponse(200, {}))
    with pytest.raises(CredentialChangeUncertain):
        invalid_success.change_access_key("old-key", "new-key", "old-token", None)


def test_try_login_only_converts_explicit_auth_rejection_to_none():
    invalid = NovelAIClient(request_func=lambda *args, **kwargs: FakeResponse(403, {}))
    assert invalid.try_login("bad-key") is None

    captcha = NovelAIClient(
        request_func=lambda *args, **kwargs: FakeResponse(
            403,
            {"code": "CAPTCHA_REQUIRED"},
        )
    )
    with pytest.raises(NovelAIUpstreamError) as captcha_required:
        captcha.try_login("unknown-key")
    assert captcha_required.value.code == "OFFICIAL_CAPTCHA_REQUIRED"

    unavailable = NovelAIClient(request_func=lambda *args, **kwargs: FakeResponse(500, {}))
    with pytest.raises(NovelAIUpstreamError):
        unavailable.try_login("unknown-key")
